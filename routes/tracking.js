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

// 2) Generate PDF for tracking code and stream it back (download)
router.get('/:code/pdf', async (req, res) => {
    try {
        const code = (req.params.code || '').trim();
        if (!code) return res.status(400).json({ error: 'Tracking code required' });

        const shipment = await Shipment.findOne({
            trackingNumber: { $regex: `^${code}$`, $options: 'i' }
        }).lean();

        if (!shipment) return res.status(404).json({ error: 'Shipment not found' });

        // Create barcode image (Code128) buffer using bwip-js
        const barcodeBuffer = await bwipjs.toBuffer({
            bcid: 'code128',
            text: String(shipment.trackingNumber || code),
            scale: 3,     // 3x scaling
            height: 50,   // bar height, in px
            includetext: false,
            paddingwidth: 10,
            paddingheight: 10
        });

        // Create QR code buffer (link back to a public tracking page)
        const publicTrackingUrl =
            (process.env.PUBLIC_TRACKING_URL || `${req.protocol}://${req.get('host')}/track?code=${encodeURIComponent(shipment.trackingNumber)}`);
        const qrBuffer = await QRCode.toBuffer(publicTrackingUrl, { type: 'png', margin: 1, width: 200 });

        // Prepare PDF response headers
        const filenameSafe = (shipment.trackingNumber || code).replace(/[^a-z0-9\-_\.]/gi, '-');
        res.setHeader('Content-Disposition', `attachment; filename="${filenameSafe}.pdf"`);
        res.setHeader('Content-Type', 'application/pdf');

        // Create PDF
        const doc = new PDFDocument({ size: 'A4', margin: 48 });

        // Stream PDF to response
        doc.pipe(res);

        // --- PDF content layout ---
        // Header
        doc.fontSize(20).text('Shipment Details', { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor('gray').text(`Generated: ${new Date().toISOString()}`, { align: 'center' });
        doc.moveDown(1.2);

        // Two-column layout: left summary + barcode/qr, right big details
        const leftWidth = 200;
        const startX = doc.x;
        const startY = doc.y;

        // Left box: tracking and barcode + QR
        doc.rect(startX - 8, startY - 8, leftWidth + 16, 300).strokeOpacity(0.06).stroke('#000000');
        doc.fontSize(12).fillColor('black').text(`Tracking: ${shipment.trackingNumber || '-'}`, startX, startY);
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor('gray').text(`Status: ${shipment.status || '-'}`);
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor('gray').text(`Expected: ${shipment.expectedDeliveryDate || shipment.estimatedDelivery || '-'}`);
        doc.moveDown(0.8);

        // Draw barcode
        const barcodeY = doc.y;
        doc.image(barcodeBuffer, startX, barcodeY, { width: leftWidth - 20, align: 'center' });
        doc.moveDown(5);

        // Draw QR code to the right of barcode (or below, if narrow)
        const qrX = startX;
        const qrY = barcodeY + 80;
        doc.image(qrBuffer, qrX, qrY, { width: 110, height: 110 });

        // Shareable URL text
        doc.fontSize(8).fillColor('gray').text(publicTrackingUrl, startX, qrY + 115, { width: leftWidth - 10, align: 'left' });

        // Move cursor to the right column
        const rightX = startX + leftWidth + 24;
        doc.x = rightX;
        doc.y = startY;

        // Right column: full details
        doc.fontSize(14).fillColor('black').text('Full Shipment Information', { underline: true });
        doc.moveDown(0.4);
        doc.fontSize(10).fillColor('black');

        const pushKeyVal = (label, value) => {
            doc.font('Helvetica-Bold').text(`${label}: `, { continued: true, width: 120 });
            doc.font('Helvetica').text(String(value ?? '-'));
        };

        // Basic fields
        pushKeyVal('Shipper Name', shipment.shipperName);
        pushKeyVal('Shipper Address', shipment.shipperAddress);
        pushKeyVal('Receiver Name', shipment.receiverName);
        pushKeyVal('Receiver Address', shipment.receiverAddress);
        pushKeyVal('Origin', shipment.origin);
        pushKeyVal('Destination', shipment.destination);
        pushKeyVal('Carrier', shipment.carrier || '-');
        pushKeyVal('Shipment Type', shipment.shipmentType || '-');
        pushKeyVal('Shipment Mode', shipment.shipmentMode || '-');
        pushKeyVal('Carrier Ref No', shipment.carrierReferenceNo || '-');
        pushKeyVal('Product Name', shipment.productName || '-');
        pushKeyVal('Quantity', shipment.quantity ?? '-');
        pushKeyVal('Payment Mode', shipment.paymentMode || '-');
        pushKeyVal('Freight Cost', shipment.freightCost ?? '-');
        pushKeyVal('Package Count', shipment.packageCount ?? (shipment.packages ? shipment.packages.length : '-'));
        pushKeyVal('Weight (kg)', shipment.weight ?? '-');
        pushKeyVal('Departure Time', shipment.departureTime || '-');
        pushKeyVal('Pickup Date', shipment.pickupDate || '-');
        pushKeyVal('Pickup Time', shipment.pickupTime || '-');
        pushKeyVal('Comments', shipment.comments || '-');

        doc.moveDown(0.6);

        // Packages table-like section
        if (Array.isArray(shipment.packages) && shipment.packages.length > 0) {
            doc.fontSize(12).text('Packages:', { underline: true });
            doc.moveDown(0.4);
            shipment.packages.forEach((pkg, idx) => {
                doc.fontSize(10).font('Helvetica-Bold').text(`Package ${idx + 1}`, { continued: true });
                doc.font('Helvetica').text('');
                doc.fontSize(9).text(`  - Quantity: ${pkg.quantity ?? '-'}`);
                doc.text(`  - Type: ${pkg.pieceType ?? '-'}`);
                doc.text(`  - Description: ${pkg.description ?? '-'}`);
                doc.text(`  - Dimensions: ${pkg.dimensions ?? '-'}`);
                doc.text(`  - Weight: ${pkg.weight ?? '-'}`);
                doc.moveDown(0.2);
            });
        }

        doc.moveDown(0.5);

        // History
        if (Array.isArray(shipment.history) && shipment.history.length > 0) {
            doc.addPage(); // Put history on a separate page to avoid cramped first page
            doc.fontSize(16).text('Shipment History', { underline: true });
            doc.moveDown(0.6);
            shipment.history.forEach((h, idx) => {
                doc.fontSize(10).font('Helvetica-Bold').text(`${idx + 1}. ${h.date || '-'} ${h.time || ''}`);
                doc.font('Helvetica').text(`   Status: ${h.status || '-'}`);
                doc.text(`   Location: ${h.location || '-'}`);
                doc.text(`   Updated By: ${h.updatedBy || '-'}`);
                doc.text(`   Remarks: ${h.remarks || '-'}`);
                doc.moveDown(0.2);
            });
        }

        // Footer
        doc.addPage(); // optionally separate final page with summary (or comment out if not desired)
        doc.fontSize(10).text('This document was generated by the shipping system.', { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(8).fillColor('gray').text(`Tracking: ${shipment.trackingNumber} • Generated: ${new Date().toISOString()}`, { align: 'center' });

        // finalize PDF
        doc.end();

        // Note: we don't call res.end() because doc.pipe(res) will end the stream when doc.end() is called.
    } catch (err) {
        console.error('PDF generation error:', err);
        return res.status(500).json({ error: 'Failed to generate PDF' });
    }
});

export default router;
