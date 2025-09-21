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

function addFooterSmall(doc, pageNumber, trackingNumber, publicTrackingUrl) {
  try {
    const bottomY = doc.page.height - 48;
    doc.fontSize(8).font('Helvetica').fillColor('#666666');
    doc.text(`Starwood Express Logistics • ${trackingNumber}`, 50, bottomY, { align: 'left' });
    doc.text(`Page ${pageNumber} • Generated: ${new Date().toLocaleString()}`, 50, bottomY, { align: 'right' });

    // small watermark text-only, very faint
    doc.save()
      .opacity(0.02)
      .fontSize(60)
      .font('Helvetica-Bold')
      .fillColor('#000000')
      .rotate(-45, { origin: [doc.page.width / 2, doc.page.height / 2] })
      .text('CONFIDENTIAL', doc.page.width / 2 - 200, doc.page.height / 2 - 40, { align: 'center' })
      .rotate(45, { origin: [doc.page.width / 2, doc.page.height / 2] })
      .restore();

    // Small tracking link at footer center (shortened)
    if (publicTrackingUrl) {
      const shortUrl = publicTrackingUrl.length > 80 ? `${publicTrackingUrl.slice(0, 77)}...` : publicTrackingUrl;
      doc.fontSize(7).fillColor('#666666').text(shortUrl, 50, bottomY + 12, { align: 'center', width: doc.page.width - 100 });
    }
  } catch (e) {
    console.warn('Footer draw skipped:', e.message);
  }
}

// Utility to draw a two-column label/value pair with alignment
function drawKeyVal(doc, xLabel, xValue, y, label, value) {
  doc.fontSize(9).font('Helvetica').fillColor('#666666').text(label + ':', xLabel, y);
  doc.font('Helvetica-Bold').fillColor('#333333').text(String(value ?? '-'), xValue, y);
}

// Route: returns a 2-page PDF (attachment) for a tracking code
router.get('/:code/pdf', async (req, res) => {
  let doc;
  try {
    const code = (req.params.code || '').trim();
    if (!code) return res.status(400).json({ error: 'Tracking code required' });

    const shipment = await Shipment.findOne({
      trackingNumber: { $regex: `^${code}$`, $options: 'i' }
    }).lean();

    if (!shipment) return res.status(404).json({ error: 'Shipment not found' });

    // Create barcode buffer (CODE128) in-memory
    const barcodeBuffer = await bwipjs.toBuffer({
      bcid: 'code128',
      text: String(shipment.trackingNumber || code),
      scale: 3,
      height: 50,
      includetext: false,
      paddingwidth: 6,
      paddingheight: 6
    });

    // Create QR buffer (in-memory)
    const publicTrackingUrl =
      (process.env.PUBLIC_TRACKING_URL || `${req.protocol}://${req.get('host')}/track?code=${encodeURIComponent(shipment.trackingNumber)}`);
    const qrBuffer = await QRCode.toBuffer(publicTrackingUrl, {
      type: 'png',
      margin: 1,
      width: 140,
      color: { dark: '#003366', light: '#FFFFFF' }
    });

    // prepare response headers before piping
    const filenameSafe = (shipment.trackingNumber || code).replace(/[^a-z0-9\-_\.]/gi, '-');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameSafe}.pdf"`);
    res.setHeader('Content-Type', 'application/pdf');

    // Create PDF document
    doc = new PDFDocument({
      size: 'A4',
      margin: 48,
      info: {
        Title: `Shipment Details - ${shipment.trackingNumber}`,
        Author: 'Starwood Express Logistics'
      }
    });

    // error handlers
    const onDocError = (err) => {
      console.error('PDF Document error:', err);
      try { if (!res.headersSent) res.status(500).json({ error: 'PDF generation failed' }); } catch (e) {}
      try { res.destroy(err); } catch (e) {}
    };
    const onResClose = () => {
      if (doc && !doc._ending) {
        try { doc.end(); } catch (e) {}
      }
    };
    doc.on('error', onDocError);
    res.on('close', onResClose);
    res.on('error', (err) => { console.error('Response stream error:', err); onResClose(); });

    doc.pipe(res);

    // ===========================
    // PAGE 1 - COVER & OVERVIEW
    // ===========================
    // Top branding band
    doc.rect(0, 0, doc.page.width, 72).fill('#003366');
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(18).text('STARWOOD EXPRESS LOGISTICS', 52, 22);
    doc.font('Helvetica').fontSize(9).fillColor('#E6EEF8').text('Global Logistics Solutions', 52, 44);

    // Title area
    doc.addPage(); // start fresh page for content with consistent spacing
    let pageNumber = 1;
    addFooterSmall(doc, pageNumber, shipment.trackingNumber, publicTrackingUrl);

    doc.fontSize(20).fillColor('#003366').font('Helvetica-Bold').text('SHIPMENT DETAILS', 50, 48);
    doc.fontSize(9).fillColor('#666666').font('Helvetica').text(`Generated: ${new Date().toLocaleString()}`, 50, 72);

    // Two-column layout coordinates (left column smaller)
    const leftX = 50;
    const rightX = 320;
    let cursorY = 100;

    // TRACKING BLOCK - left column top
    doc.rect(leftX - 6, cursorY - 6, 240, 110).stroke('#E8EDF3').lineWidth(0.5);
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#003366').text('TRACKING', leftX, cursorY);
    drawKeyVal(doc, leftX, leftX + 110, cursorY + 22, 'Tracking Number', shipment.trackingNumber);
    drawKeyVal(doc, leftX, leftX + 110, cursorY + 40, 'Status', shipment.status);
    drawKeyVal(doc, leftX, leftX + 110, cursorY + 58, 'Expected', shipment.expectedDeliveryDate || '-');
    drawKeyVal(doc, leftX, leftX + 110, cursorY + 76, 'Pickup Date', shipment.pickupDate || '-');

    // Barcode + QR under tracking block (left col)
    const codesY = cursorY + 100;
    try { doc.image(barcodeBuffer, leftX, codesY, { width: 220 }); } catch (e) { console.warn('Barcode draw failed:', e.message); }
    try { doc.image(qrBuffer, leftX + 230, codesY - 8, { width: 110, height: 110 }); } catch (e) { console.warn('QR draw failed:', e.message); }
    doc.fontSize(8).fillColor('#666666').text('Scan QR for live tracking', leftX + 230, codesY + 105, { width: 110, align: 'center' });

    // RIGHT column: Shipment Overview
    cursorY = 100;
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#003366').text('OVERVIEW', rightX, cursorY);
    const overview = [
      ['Origin', shipment.origin || '-'],
      ['Destination', shipment.destination || '-'],
      ['Carrier', shipment.carrier || '-'],
      ['Service', shipment.shipmentType || '-'],
      ['Mode', shipment.shipmentMode || '-'],
      ['Total Weight', shipment.weight ? `${shipment.weight} kg` : '-']
    ];
    let overviewY = cursorY + 22;
    overview.forEach(([k, v]) => {
      doc.fontSize(9).font('Helvetica').fillColor('#666666').text(k + ':', rightX, overviewY);
      doc.font('Helvetica-Bold').fillColor('#333333').text(v, rightX + 90, overviewY);
      overviewY += 14;
    });

    // Shipper & Receiver blocks under overview
    const blocksY = Math.max(codesY + 140, overviewY + 10);
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#003366').text('SHIPPER', leftX, blocksY);
    doc.fontSize(9).font('Helvetica').fillColor('#333333').text(shipment.shipperName || '-', leftX, blocksY + 16);
    doc.fontSize(8).fillColor('#666666').text(shipment.shipperAddress || '-', leftX, blocksY + 30, { width: 240 });

    doc.fontSize(11).font('Helvetica-Bold').fillColor('#003366').text('RECEIVER', rightX, blocksY);
    doc.fontSize(9).font('Helvetica').fillColor('#333333').text(shipment.receiverName || '-', rightX, blocksY + 16);
    doc.fontSize(8).fillColor('#666666').text(shipment.receiverAddress || '-', rightX, blocksY + 30, { width: 240 });

    // Additional details compact area (bottom of page 1)
    const bottomLeftY = blocksY + 70;
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#003366').text('DETAILS', leftX, bottomLeftY);
    const smallDetails = [
      ['Product', shipment.productName || '-'],
      ['Qty', shipment.quantity ?? '-'],
      ['Payment', shipment.paymentMode || '-'],
      ['Freight', shipment.freightCost ? `$${shipment.freightCost}` : '-'],
      ['Carrier Ref', shipment.carrierReferenceNo || '-']
    ];
    let smallY = bottomLeftY + 18;
    smallDetails.forEach(([k, v]) => {
      doc.fontSize(9).font('Helvetica').fillColor('#666666').text(`${k}: ${v}`, leftX, smallY);
      smallY += 12;
    });

    // Finish first page -> do NOT add more pages except exactly one more
    // ===========================
    // PAGE 2 - PACKAGES + HISTORY (compact)
    // ===========================
    doc.addPage();
    pageNumber = 2;
    addFooterSmall(doc, pageNumber, shipment.trackingNumber, publicTrackingUrl);

    // Page 2 header
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#003366').text('PACKAGE DETAILS & HISTORY', 50, 48);
    doc.moveTo(50, 66).lineTo(doc.page.width - 50, 66).strokeColor('#DDDDDD').stroke();

    // Available vertical space for entries (from y=80 to footer area ~ doc.page.height - 110)
    const topY = 80;
    const bottomLimit = doc.page.height - 110;
    let y = topY;

    // PACKAGES TABLE (compact rows)
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#003366').text('Packages', 50, y);
    y += 16;
    // table header row (small)
    doc.fontSize(9).fillColor('#FFFFFF').font('Helvetica-Bold');
    // draw header band
    doc.rect(50, y - 6, doc.page.width - 100, 18).fill('#003366');
    doc.fillColor('#FFFFFF').text('Type', 56, y - 4);
    doc.text('Description', 120, y - 4);
    doc.text('Dimensions', 320, y - 4);
    doc.text('Weight', 420, y - 4);
    doc.text('Qty', 480, y - 4);
    y += 20;

    doc.fillColor('#333333').font('Helvetica').fontSize(9);

    const packages = Array.isArray(shipment.packages) ? shipment.packages : [];
    // Estimate rows that fit: compute available height
    const availableHeight = bottomLimit - y;
    const approxRowHeight = 16;
    const maxPackageRows = Math.max(0, Math.floor(availableHeight / approxRowHeight / 2)); // allocate about half page for packages
    const packageRowsToShow = Math.min(packages.length, Math.max(3, maxPackageRows)); // show at least 3 if present

    for (let i = 0; i < packageRowsToShow; i++) {
      const pkg = packages[i];
      // alternate background subtle
      if (i % 2 === 0) {
        doc.rect(50, y - 4, doc.page.width - 100, 16).fill('#F8F9FA');
        doc.fillColor('#333333');
      }
      doc.text(pkg.pieceType || '-', 56, y);
      doc.text((pkg.description || '-').slice(0, 40), 120, y, { width: 180 });
      doc.text((pkg.dimensions || '-'), 320, y);
      doc.text(pkg.weight ? `${pkg.weight} kg` : '-', 420, y);
      doc.text(String(pkg.quantity ?? '-'), 480, y);
      y += 18;
    }

    // If we didn't show all packages, show a compact message
    if (packages.length > packageRowsToShow) {
      const remaining = packages.length - packageRowsToShow;
      doc.fontSize(9).fillColor('#666666').text(`+ ${remaining} more package(s). View full list at tracking page.`, 56, y + 6);
      y += 22;
    } else {
      y += 8;
    }

    // HISTORY (compact timeline)
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#003366').text('History', 50, y);
    y += 16;

    const history = Array.isArray(shipment.history) ? shipment.history : [];
    // Remaining vertical space for history
    const remainingHeightForHistory = bottomLimit - y;
    const approxHistoryRow = 34; // compact rows
    const maxHistoryRows = Math.max(0, Math.floor(remainingHeightForHistory / approxHistoryRow));
    const historyToShow = Math.min(history.length, Math.max(1, Math.min(10, maxHistoryRows))); // show at least 1

    for (let i = 0; i < historyToShow; i++) {
      const h = history[i];
      // small timeline marker
      doc.circle(60, y + 8, 4).fill('#003366');
      doc.fontSize(10).fillColor('#003366').font('Helvetica-Bold').text(h.status || '-', 74, y);
      doc.fontSize(8).fillColor('#666666').font('Helvetica').text(`${h.date || ''} ${h.time || ''}`, 74, y + 12);
      const locationText = `Location: ${h.location || 'Not specified'}`;
      doc.fontSize(8).fillColor('#333333').text(locationText, 220, y);
      if (h.remarks) {
        doc.fontSize(8).fillColor('#666666').text(`Remarks: ${(h.remarks || '').slice(0, 120)}`, 74, y + 22, { width: doc.page.width - 140 });
      }
      y += approxHistoryRow;
    }

    if (history.length > historyToShow) {
      const rem = history.length - historyToShow;
      doc.fontSize(9).fillColor('#666666').text(`+ ${rem} more history entries. See full history at:`, 56, y + 6);
      doc.fontSize(8).fillColor('#003366').text(publicTrackingUrl, 56, y + 20, { width: doc.page.width - 120 });
      y += 36;
    }

    // Final small summary block (bottom)
    doc.fontSize(9).fillColor('#333333').font('Helvetica-Bold').text('Need help?', 50, doc.page.height - 140);
    doc.fontSize(8).fillColor('#666666').text('Contact Starwood Express Logistics Customer Support', 50, doc.page.height - 126);
    doc.fontSize(8).fillColor('#003366').text('support@starwoodexpress.com | +1-800-STARWOOD', 50, doc.page.height - 112);

    // finalize
    doc.end();
  } catch (err) {
    console.error('PDF generation error (2-page):', err);
    try {
      if (!res.headersSent) return res.status(500).json({ error: 'Failed to generate PDF' });
      res.destroy(err);
    } catch (e) {
      console.error('Error handling PDF exception:', e);
    }
  }
});

export default router;
