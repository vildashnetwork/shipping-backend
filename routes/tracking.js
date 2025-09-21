// routes/shipment.js
import express from 'express';
import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';
import QRCode from 'qrcode';
import Shipment from '../models/shipmentschma.js';

const router = express.Router();

// --- existing routes (GET /, GET /:id, POST /, PUT /:id, DELETE /:id) ---
// keep them as they are

// 1) Lookup by tracking code (existing JSON endpoint)
router.get('/:code', async (req, res) => {
    try {
        const code = (req.params.code || '').trim();
        if (!code) return res.status(400).json({ error: 'Tracking code required' });

        const shipment = await Shipment.findOne({
            trackingNumber: { $regex: `^${code}$`, $options: 'i' }
        });

        if (!shipment) return res.status(404).json({ error: 'Shipment not found' });

        return res.status(200).json({ shipment });
    } catch (err) {
        console.error('Tracking lookup error', err);
        return res.status(500).json({ error: 'Server error' });
    }
});

function addFooter(doc, pageNumber, trackingNumber) {
  try {
    const bottomY = doc.page.height - 40;
    doc.fontSize(8)
      .font('Helvetica')
      .fillColor('#666666')
      .text(`Starwood Express Logistics • ${trackingNumber}`, 50, bottomY, { align: 'left' })
      .text(`Page ${pageNumber} • Generated: ${new Date().toLocaleString()}`, 50, bottomY, { align: 'right' });

    // subtle watermark (text-only)
    doc.save()
      .opacity(0.03)
      .fontSize(80)
      .font('Helvetica-Bold')
      .fillColor('#000000')
      .rotate(-45, { origin: [doc.page.width / 2, doc.page.height / 2] })
      .text('CONFIDENTIAL', doc.page.width / 2 - 220, doc.page.height / 2 - 40, { align: 'center' })
      .rotate(45, { origin: [doc.page.width / 2, doc.page.height / 2] })
      .restore();
  } catch (e) {
    // do not throw; watermark/footer are non-critical
    console.warn('Footer/watermark draw failed:', e.message);
  }
}

router.get('/:code/pdf', async (req, res) => {
  let doc;
  try {
    const code = (req.params.code || '').trim();
    if (!code) return res.status(400).json({ error: 'Tracking code required' });

    const shipment = await Shipment.findOne({
      trackingNumber: { $regex: `^${code}$`, $options: 'i' }
    }).lean();

    if (!shipment) return res.status(404).json({ error: 'Shipment not found' });

    // Generate barcode (CODE128) buffer in-memory
    const barcodeBuffer = await bwipjs.toBuffer({
      bcid: 'code128',
      text: String(shipment.trackingNumber || code),
      scale: 3,
      height: 50,
      includetext: false,
      paddingwidth: 10,
      paddingheight: 10
    });

    // Generate QR buffer with the public tracking URL (in-memory)
    const publicTrackingUrl =
      (process.env.PUBLIC_TRACKING_URL || `${req.protocol}://${req.get('host')}/track?code=${encodeURIComponent(shipment.trackingNumber)}`);
    const qrBuffer = await QRCode.toBuffer(publicTrackingUrl, {
      type: 'png',
      margin: 1,
      width: 160,
      color: { dark: '#003366', light: '#FFFFFF' } // brand color for QR dark modules
    });

    // Force download via header (attachment)
    const filenameSafe = (shipment.trackingNumber || code).replace(/[^a-z0-9\-_\.]/gi, '-');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameSafe}.pdf"`);
    res.setHeader('Content-Type', 'application/pdf');

    // Create doc and pipe to response
    doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: `Shipment Details - ${shipment.trackingNumber}`,
        Author: 'Starwood Express Logistics',
        Subject: 'Shipment Documentation'
      }
    });

    // Attach robust error handlers BEFORE piping
    const onDocError = (err) => {
      console.error('PDF Document error:', err);
      if (!res.headersSent) {
        try { res.status(500).json({ error: 'PDF generation failed' }); } catch (e) { /* ignore */ }
      } else {
        try { res.destroy(err); } catch (e) { /* ignore */ }
      }
    };
    const onResClose = () => {
      if (doc && !doc._ending) {
        try { doc.end(); } catch (e) { /* ignore */ }
      }
    };

    doc.on('error', onDocError);
    res.on('close', onResClose);
    res.on('error', (err) => {
      console.error('Response stream error:', err);
      onResClose();
    });

    doc.pipe(res);

    // Build a clean, premium layout (no external images)
    // 1) Header band (text only, brand color)
    doc.rect(0, 0, doc.page.width, 80).fill('#003366'); // brand band
    doc.fillColor('#FFFFFF').fontSize(18).font('Helvetica-Bold').text('STARWOOD EXPRESS LOGISTICS', 50, 28, { align: 'left' });
    doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica').text('Global Logistics Solutions', 50, 52, { align: 'left' });

    // Move to content area on a new page to avoid overlap
    doc.addPage();
    let pageCount = 1;
    addFooter(doc, pageCount, shipment.trackingNumber);

    // Title + metadata
    doc.fontSize(18).fillColor('#003366').font('Helvetica-Bold').text('SHIPMENT DETAILS', 50, 60);
    doc.fontSize(9).fillColor('#666666').font('Helvetica')
      .text(`Generated: ${new Date().toLocaleString()} | Document ID: ${Math.random().toString(36).substring(2, 10).toUpperCase()}`, 50, 84);

    // Two-column coordinates
    const leftCol = 50;
    const rightCol = 320;
    const topStart = 120;

    // Left - Tracking Information
    doc.fontSize(12).fillColor('#003366').font('Helvetica-Bold').text('TRACKING INFORMATION', leftCol, topStart);
    doc.fontSize(10).font('Helvetica').fillColor('#333333');

    const infoTop = topStart + 25;
    doc.text('Tracking Number:', leftCol, infoTop);
    doc.font('Helvetica-Bold').text(shipment.trackingNumber || '-', leftCol + 120, infoTop);

    doc.font('Helvetica').text('Status:', leftCol, infoTop + 20);
    const statusColor = (shipment.status === 'Delivered') ? '#28a745' : (shipment.status === 'In Transit') ? '#17a2b8' : (shipment.status === 'Exception') ? '#dc3545' : '#6c757d';
    doc.font('Helvetica-Bold').fillColor(statusColor).text(shipment.status || '-', leftCol + 120, infoTop + 20);
    doc.fillColor('#333333');

    doc.font('Helvetica').fillColor('#333333').text('Expected Delivery:', leftCol, infoTop + 40);
    doc.font('Helvetica-Bold').text(shipment.expectedDeliveryDate || '-', leftCol + 120, infoTop + 40);

    // Embed barcode (from buffer) and QR (from buffer) — still no disk images
    const codesTop = infoTop + 70;
    try {
      doc.image(barcodeBuffer, leftCol, codesTop, { width: 200 });
    } catch (e) {
      console.warn('Barcode draw failed (non-fatal):', e.message);
    }
    try {
      doc.image(qrBuffer, leftCol + 220, codesTop - 10, { width: 100, height: 100 });
    } catch (e) {
      console.warn('QR draw failed (non-fatal):', e.message);
    }
    doc.fontSize(8).font('Helvetica').fillColor('#666666').text('Scan QR code for real-time tracking', leftCol + 220, codesTop + 95, { width: 100, align: 'center' });

    // Right - Shipment Overview
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#003366').text('SHIPMENT OVERVIEW', rightCol, topStart);
    const overviewTop = topStart + 25;
    const overviewData = [
      { label: 'Origin', value: shipment.origin || '-' },
      { label: 'Destination', value: shipment.destination || '-' },
      { label: 'Carrier', value: shipment.carrier || '-' },
      { label: 'Service Type', value: shipment.shipmentType || '-' },
      { label: 'Total Weight', value: shipment.weight ? `${shipment.weight} kg` : '-' },
      { label: 'Package Count', value: shipment.packageCount ?? (shipment.packages ? shipment.packages.length : '-') }
    ];
    overviewData.forEach((item, i) => {
      const yPos = overviewTop + (i * 15);
      doc.fontSize(9).font('Helvetica').fillColor('#666666').text(item.label + ':', rightCol, yPos);
      doc.font('Helvetica-Bold').fillColor('#333333').text(item.value, rightCol + 90, yPos);
    });

    // Shipper & Receiver blocks
    const detailsTop = codesTop + 120;
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#003366').text('SHIPPER INFORMATION', leftCol, detailsTop);
    doc.fontSize(10).font('Helvetica').fillColor('#333333')
      .text(shipment.shipperName || '-', leftCol, detailsTop + 20)
      .text(shipment.shipperAddress || '-', leftCol, detailsTop + 35, { width: 240 });

    doc.fontSize(12).font('Helvetica-Bold').fillColor('#003366').text('RECEIVER INFORMATION', rightCol, detailsTop);
    doc.fontSize(10).font('Helvetica').fillColor('#333333')
      .text(shipment.receiverName || '-', rightCol, detailsTop + 20)
      .text(shipment.receiverAddress || '-', rightCol, detailsTop + 35, { width: 240 });

    // Additional details
    const additionalTop = detailsTop + 80;
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#003366').text('ADDITIONAL DETAILS', leftCol, additionalTop);
    const additionalData = [
      { label: 'Product Name', value: shipment.productName || '-' },
      { label: 'Quantity', value: shipment.quantity ?? '-' },
      { label: 'Payment Mode', value: shipment.paymentMode || '-' },
      { label: 'Freight Cost', value: shipment.freightCost ? `$${shipment.freightCost}` : '-' },
      { label: 'Carrier Reference', value: shipment.carrierReferenceNo || '-' }
    ];
    additionalData.forEach((item, i) => {
      const yPos = additionalTop + 20 + (i * 15);
      doc.fontSize(9).font('Helvetica').fillColor('#666666').text(item.label + ':', leftCol, yPos);
      doc.font('Helvetica-Bold').fillColor('#333333').text(item.value, leftCol + 100, yPos);
    });

    // Package details table if present (paginated)
    if (Array.isArray(shipment.packages) && shipment.packages.length > 0) {
      let packagesTop = additionalTop + 100;
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#003366').text('PACKAGE DETAILS', leftCol, packagesTop);

      const headerY = packagesTop + 18;
      // header band (filled)
      doc.rect(leftCol, headerY - 4, 510, 20).fill('#003366');
      doc.fillColor('#FFFFFF').fontSize(9)
        .text('Type', leftCol + 10, headerY)
        .text('Description', leftCol + 80, headerY)
        .text('Dimensions', leftCol + 250, headerY)
        .text('Weight', leftCol + 350, headerY)
        .text('Qty', leftCol + 420, headerY);

      doc.fillColor('#333333');
      let tableY = headerY + 24;
      for (let idx = 0; idx < shipment.packages.length; idx++) {
        const pkg = shipment.packages[idx];
        // New page when near bottom
        if (tableY > doc.page.height - 120) {
          doc.addPage();
          pageCount++;
          addFooter(doc, pageCount, shipment.trackingNumber);
          tableY = 100;
        }
        if (idx % 2 === 0) {
          doc.rect(leftCol, tableY - 2, 510, 20).fill('#F8F9FA');
          doc.fillColor('#333333');
        }
        doc.fontSize(9).font('Helvetica')
          .text(pkg.pieceType || '-', leftCol + 10, tableY)
          .text(pkg.description || '-', leftCol + 80, tableY, { width: 160 })
          .text(pkg.dimensions || '-', leftCol + 250, tableY)
          .text(pkg.weight ? `${pkg.weight} kg` : '-', leftCol + 350, tableY)
          .text(pkg.quantity ?? '-', leftCol + 420, tableY);
        tableY += 24;
      }
    }

    // History pages (if any)
    if (Array.isArray(shipment.history) && shipment.history.length > 0) {
      doc.addPage();
      pageCount++;
      addFooter(doc, pageCount, shipment.trackingNumber);
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#003366').text('SHIPMENT HISTORY', 50, 80);

      let historyY = 110;
      for (let i = 0; i < shipment.history.length; i++) {
        const h = shipment.history[i];
        if (historyY > doc.page.height - 120) {
          doc.addPage();
          pageCount++;
          addFooter(doc, pageCount, shipment.trackingNumber);
          historyY = 80;
        }
        doc.circle(70, historyY + 6, 4).fill('#003366');
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#003366').text(h.status || 'Status update', 90, historyY);
        doc.fontSize(9).font('Helvetica').fillColor('#666666').text(`${h.date || ''} ${h.time || ''}`, 90, historyY + 14);
        doc.fontSize(9).font('Helvetica').fillColor('#333333').text(`Location: ${h.location || 'Not specified'}`, 90, historyY + 28, { width: 400 });
        if (h.remarks) {
          doc.fontSize(8).fillColor('#666666').text(`Remarks: ${h.remarks}`, 90, historyY + 44, { width: 400 });
          historyY += 70;
        } else {
          historyY += 54;
        }
      }
    }

    // Final summary page
    doc.addPage();
    pageCount++;
    addFooter(doc, pageCount, shipment.trackingNumber);
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#003366').text('DOCUMENT SUMMARY', 50, 80, { align: 'center' });
    doc.moveTo(50, 100).lineTo(doc.page.width - 50, 100).strokeColor('#DDDDDD').stroke();
    doc.fontSize(10).font('Helvetica').fillColor('#333333')
      .text('This document contains confidential shipment information intended solely for the recipient.', 50, 120, { align: 'center', width: doc.page.width - 100 });
    doc.moveDown();
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#003366')
      .text('Starwood Express Logistics Customer Support', 50, 180, { align: 'center' });
    doc.fontSize(9).font('Helvetica').fillColor('#333333')
      .text('Email: support@starwoodexpress.com | Phone: +1-800-STARWOOD', 50, 200, { align: 'center' });
    doc.fontSize(8).fillColor('#666666')
      .text(`Document generated: ${new Date().toLocaleString()}`, 50, doc.page.height - 80, { align: 'center' })
      .text(`Tracking Number: ${shipment.trackingNumber}`, 50, doc.page.height - 65, { align: 'center' })
      .text('© ' + new Date().getFullYear() + ' Starwood Express Logistics. All rights reserved.', 50, doc.page.height - 50, { align: 'center' });

    // finalize PDF stream
    doc.end();
  } catch (err) {
    console.error('PDF generation error (route):', err);
    try {
      if (!res.headersSent) return res.status(500).json({ error: 'Failed to generate PDF' });
      res.destroy(err);
    } catch (e) {
      console.error('Error while handling PDF error:', e);
    }
  }
});

export default router;
