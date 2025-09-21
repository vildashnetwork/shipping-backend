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


function safeText(doc, text, x, y, opts = {}) {
  try { doc.text(String(text ?? '-'), x, y, opts); } catch (e) { console.warn('safeText failed', e.message); }
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

    // Generate in-memory barcode and QR
    const barcodeBuffer = await bwipjs.toBuffer({
      bcid: 'code128',
      text: String(shipment.trackingNumber || code),
      scale: 3,
      height: 50,
      includetext: false,
      paddingwidth: 6,
      paddingheight: 6
    });

    const publicTrackingUrl =
      (process.env.PUBLIC_TRACKING_URL || `${req.protocol}://${req.get('host')}/track?code=${encodeURIComponent(shipment.trackingNumber)}`);
    const qrBuffer = await QRCode.toBuffer(publicTrackingUrl, { type: 'png', margin: 1, width: 140 });

    // Force download headers
    const filenameSafe = (shipment.trackingNumber || code).replace(/[^a-z0-9\-_\.]/gi, '-');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameSafe}.pdf"`);
    res.setHeader('Content-Type', 'application/pdf');

    // Create PDF doc and pipe
    doc = new PDFDocument({ size: 'A4', margin: 48, autoFirstPage: false });

    // Error handlers
    const onDocError = (err) => {
      console.error('PDF Document error:', err);
      try { if (!res.headersSent) res.status(500).json({ error: 'PDF generation failed' }); } catch (e) {}
      try { res.destroy(err); } catch (e) {}
    };
    doc.on('error', onDocError);
    res.on('error', (err) => { console.error('Response error:', err); if (doc && !doc._ending) try { doc.end(); } catch (e) {} });

    doc.pipe(res);

    // ---- PAGE 1 ----
    doc.addPage();
    // fixed header band (top)
    doc.rect(0, 0, doc.page.width, 72).fill('#003366');
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(18).text('STARWOOD EXPRESS LOGISTICS', 52, 22);
    doc.font('Helvetica').fontSize(9).fillColor('#E6EEF8').text('Global Logistics Solutions', 52, 44);

    // Content start Y (strict)
    const page1Top = 90;

    // Coordinates & fixed boxes
    const leftX = 48;            // left margin
    const leftW = 260;          // left column width (tracking + barcode)
    const rightX = leftX + leftW + 20; // right column start
    const rightW = doc.page.width - rightX - 48; // right column width
    const lineH = 14;

    // Title
    doc.fillColor('#003366').font('Helvetica-Bold').fontSize(16).text('SHIPMENT DETAILS', leftX, page1Top);

    // TRACKING box (fixed height)
    const trackY = page1Top + 26;
    const trackH = 180; // fixed box height so nothing else jumps into it
    doc.roundedRect(leftX - 6, trackY - 6, leftW + 12, trackH + 12, 6).stroke('#E8EDF3');

    // inside tracking box, use absolute y increments
    let y = trackY;
    doc.fontSize(10).fillColor('#003366').font('Helvetica-Bold').text('TRACKING', leftX, y);
    y += lineH;
    doc.fontSize(9).fillColor('#666666').font('Helvetica').text('Tracking Number:', leftX, y);
    doc.font('Helvetica-Bold').fillColor('#333333').text(shipment.trackingNumber || '-', leftX + 110, y);
    y += lineH;
    doc.font('Helvetica').fillColor('#666666').text('Status:', leftX, y);
    const statusColor = (shipment.status === 'Delivered') ? '#28a745' : (shipment.status === 'In Transit') ? '#17a2b8' : (shipment.status === 'Exception') ? '#dc3545' : '#6c757d';
    doc.font('Helvetica-Bold').fillColor(statusColor).text(shipment.status || '-', leftX + 110, y);
    y += lineH;
    doc.font('Helvetica').fillColor('#666666').text('Expected Delivery:', leftX, y);
    doc.font('Helvetica-Bold').fillColor('#333333').text(shipment.expectedDeliveryDate || '-', leftX + 110, y);
    y += lineH;
    doc.font('Helvetica').fillColor('#666666').text('Pickup Date:', leftX, y);
    doc.font('Helvetica-Bold').fillColor('#333333').text(shipment.pickupDate || '-', leftX + 110, y);

    // Barcode placed near bottom of tracking box (fixed position)
    const barcodeY = trackY + trackH - 68;
    try { doc.image(barcodeBuffer, leftX + 6, barcodeY, { width: leftW - 12 }); } catch (e) { console.warn('barcode draw fail', e.message); }

    // QR to the right of barcode, but inside left area (keeps columns clean)
    try { doc.image(qrBuffer, leftX + leftW - 90, barcodeY - 10, { width: 80, height: 80 }); } catch (e) { console.warn('qr draw fail', e.message); }

    // RIGHT column: Overview (fixed rows)
    let ry = trackY;
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#003366').text('OVERVIEW', rightX, ry);
    ry += lineH + 6;
    const overview = [
      ['Origin', shipment.origin || '-'],
      ['Destination', shipment.destination || '-'],
      ['Carrier', shipment.carrier || '-'],
      ['Service Type', shipment.shipmentType || '-'],
      ['Total Weight', shipment.weight ? `${shipment.weight} kg` : '-'],
      ['Package Count', shipment.packageCount ?? (shipment.packages ? shipment.packages.length : '-')]
    ];
    overview.forEach(([k, v]) => {
      doc.fontSize(9).font('Helvetica').fillColor('#666666').text(k + ':', rightX, ry);
      doc.font('Helvetica-Bold').fillColor('#333333').text(String(v), rightX + 110, ry);
      ry += lineH;
    });

    // Shipper / Receiver blocks (fixed positions below overview and tracking)
    const blocksTop = trackY + trackH + 18;
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#003366').text('SHIPPER', leftX, blocksTop);
    doc.fontSize(9).font('Helvetica').fillColor('#333333').text(shipment.shipperName || '-', leftX, blocksTop + 16);
    doc.fontSize(8).fillColor('#666666').text(shipment.shipperAddress || '-', leftX, blocksTop + 30, { width: leftW });

    doc.fontSize(11).font('Helvetica-Bold').fillColor('#003366').text('RECEIVER', rightX, blocksTop);
    doc.fontSize(9).font('Helvetica').fillColor('#333333').text(shipment.receiverName || '-', rightX, blocksTop + 16);
    doc.fontSize(8).fillColor('#666666').text(shipment.receiverAddress || '-', rightX, blocksTop + 30, { width: rightW });

    // Small details row (single line compact)
    const detailsY = blocksTop + 80;
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#003366').text('DETAILS', leftX, detailsY);
    const detailsText = `Product: ${shipment.productName || '-'}  |  Qty: ${shipment.quantity ?? '-'}  |  Payment: ${shipment.paymentMode || '-'}  |  Freight: ${shipment.freightCost ? `$${shipment.freightCost}` : '-'}`;
    doc.fontSize(9).font('Helvetica').fillColor('#666666').text(detailsText, leftX, detailsY + 16, { width: doc.page.width - 96 });

    // ---- End Page 1 content ----

    // ---- PAGE 2 ---- (fixed layout; top header mirrored very small)
    doc.addPage();
    // small header band on page 2
    doc.rect(0, 0, doc.page.width, 56).fill('#003366');
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(12).text('STARWOOD EXPRESS LOGISTICS', 52, 18);
    doc.fillColor('#E6EEF8').font('Helvetica').fontSize(8).text('Shipment Packages & History', 52, 34);

    // page2 content coordinates
    const pg2Left = 48;
    const pg2Right = 48;
    let y2 = 80;
    const footerReserve = 96;
    const page2BottomLimit = doc.page.height - footerReserve;

    // PACKAGES section (compact table)
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#003366').text('PACKAGE DETAILS', pg2Left, y2);
    y2 += 18;

    // header row (colored)
    const tableW = doc.page.width - pg2Left - pg2Right;
    doc.rect(pg2Left, y2 - 6, tableW, 18).fill('#003366');
    doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold').text('Type', pg2Left + 6, y2 - 4);
    doc.text('Description', pg2Left + 80, y2 - 4);
    doc.text('Dimensions', pg2Left + 300, y2 - 4);
    doc.text('Weight', pg2Left + 410, y2 - 4);
    doc.text('Qty', pg2Left + 470, y2 - 4);
    y2 += 22;

    doc.fillColor('#333333').font('Helvetica').fontSize(9);
    const packages = Array.isArray(shipment.packages) ? shipment.packages : [];
    // allocate about 40% of page height for packages
    const packagesSpace = Math.floor((page2BottomLimit - y2) * 0.45);
    const rowH = 16;
    const maxPackageRows = Math.max(0, Math.floor(packagesSpace / rowH));
    const packageRows = Math.min(packages.length, Math.max(1, Math.min(maxPackageRows, 12))); // cap rows

    for (let i = 0; i < packageRows; i++) {
      const pkg = packages[i];
      if (i % 2 === 0) {
        doc.rect(pg2Left, y2 - 4, tableW, rowH).fill('#F8F9FA');
        doc.fillColor('#333333');
      }
      doc.text(pkg.pieceType || '-', pg2Left + 6, y2);
      doc.text((pkg.description || '-').slice(0, 40), pg2Left + 80, y2, { width: 200 });
      doc.text(pkg.dimensions || '-', pg2Left + 300, y2);
      doc.text(pkg.weight ? `${pkg.weight} kg` : '-', pg2Left + 410, y2);
      doc.text(String(pkg.quantity ?? '-'), pg2Left + 470, y2);
      y2 += rowH + 4;
    }

    if (packages.length > packageRows) {
      const remaining = packages.length - packageRows;
      doc.fontSize(9).fillColor('#666666').text(`+ ${remaining} more package(s) available on the tracking page.`, pg2Left + 6, y2 + 6);
      y2 += 24;
    } else {
      y2 += 8;
    }

    // HISTORY section uses remaining space (compact)
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#003366').text('HISTORY', pg2Left, y2);
    y2 += 16;

    const history = Array.isArray(shipment.history) ? shipment.history : [];
    const remainingHeight = page2BottomLimit - y2;
    const historyRowH = 46; // compact
    const maxHistory = Math.max(0, Math.floor(remainingHeight / historyRowH));
    const historyToShow = Math.min(history.length, Math.max(1, Math.min(maxHistory, 10)));

    for (let i = 0; i < historyToShow; i++) {
      const h = history[i];
      // marker + content
      doc.circle(pg2Left + 8, y2 + 8, 4).fill('#003366');
      doc.fontSize(10).fillColor('#003366').font('Helvetica-Bold').text(h.status || '-', pg2Left + 24, y2);
      doc.fontSize(8).fillColor('#666666').font('Helvetica').text(`${h.date || ''} ${h.time || ''}`, pg2Left + 24, y2 + 14);
      doc.fontSize(8).fillColor('#333333').text(`Location: ${h.location || 'Not specified'}`, pg2Left + 24, y2 + 26, { width: doc.page.width - 120 });
      if (h.remarks) {
        doc.fontSize(8).fillColor('#666666').text(`Remarks: ${(h.remarks || '').slice(0, 120)}`, pg2Left + 24, y2 + 36, { width: doc.page.width - 120 });
      }
      y2 += historyRowH;
    }

    if (history.length > historyToShow) {
      const remaining = history.length - historyToShow;
      doc.fontSize(9).fillColor('#666666').text(`+ ${remaining} more history entries. See full tracking:`, pg2Left + 6, y2 + 6);
      doc.fontSize(8).fillColor('#003366').text(publicTrackingUrl, pg2Left + 6, y2 + 18, { width: doc.page.width - 120 });
      y2 += 36;
    }

    // bottom contact block (fixed)
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#003366').text('Need help?', pg2Left, doc.page.height - 120);
    doc.fontSize(8).fillColor('#666666').text('support@starwoodexpress.com • +1-800-STARWOOD', pg2Left, doc.page.height - 105);

    // final footer (center)
    doc.fontSize(8).fillColor('#666666').text(`Document generated: ${new Date().toLocaleString()} • Tracking: ${shipment.trackingNumber}`, 0, doc.page.height - 40, { align: 'center' });

    // finalize
    doc.end();
  } catch (err) {
    console.error('PDF generation error (aligned 2-page):', err);
    try {
      if (!res.headersSent) return res.status(500).json({ error: 'Failed to generate PDF' });
      res.destroy(err);
    } catch (e) {
      console.error('Error handling failure:', e);
    }
  }
});

export default router;
