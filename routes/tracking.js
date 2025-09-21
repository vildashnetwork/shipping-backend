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

        // Barcode
        const barcodeBuffer = await bwipjs.toBuffer({
            bcid: 'code128',
            text: String(shipment.trackingNumber || code),
            scale: 3,
            height: 50,
            includetext: false
        });

        // QR Code
        const publicTrackingUrl =
            (process.env.PUBLIC_TRACKING_URL || `${req.protocol}://${req.get('host')}/track?code=${encodeURIComponent(shipment.trackingNumber)}`);
        const qrBuffer = await QRCode.toBuffer(publicTrackingUrl, { type: 'png', margin: 1, width: 180 });

        // PDF Headers
        const filenameSafe = (shipment.trackingNumber || code).replace(/[^a-z0-9\-_\.]/gi, '-');
        res.setHeader('Content-Disposition', `attachment; filename="${filenameSafe}.pdf"`);
        res.setHeader('Content-Type', 'application/pdf');

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        doc.pipe(res);

        // --- Cover Page ---
        doc.image('public/starwood-logo.png', 50, 40, { width: 120 }); // brand logo
        doc.fontSize(22).fillColor('#1E3A8A').text('Starwood Express Logistics', 200, 50, { align: 'right' });
        doc.moveDown(2);

        doc.fontSize(18).fillColor('#000').text('Shipment Report', { align: 'center', underline: true });
        doc.moveDown(1);
        doc.fontSize(12).fillColor('gray').text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
        doc.moveDown(2);

        // Tracking + QR/Barcode
        doc.rect(50, 160, 500, 120).fillOpacity(0.05).fill('#1E3A8A').stroke('#1E3A8A');
        doc.fillColor('#000').fontSize(14).text(`Tracking Number: ${shipment.trackingNumber}`, 70, 180);
        doc.fontSize(12).fillColor('gray').text(`Status: ${shipment.status || '-'}`, 70, 200);
        doc.text(`Expected Delivery: ${shipment.expectedDeliveryDate || shipment.estimatedDelivery || '-'}`, 70, 220);

        doc.image(barcodeBuffer, 350, 175, { width: 180 });
        doc.image(qrBuffer, 250, 320, { width: 100, height: 100 });
        doc.fontSize(8).fillColor('gray').text(publicTrackingUrl, 50, 430);

        doc.addPage();

        // --- Shipment Details ---
        doc.fontSize(16).fillColor('#1E3A8A').text('Full Shipment Information', { underline: true });
        doc.moveDown();

        const pushKeyVal = (label, value) => {
            doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(`${label}: `, { continued: true });
            doc.font('Helvetica').fontSize(11).fillColor('gray').text(String(value ?? '-'));
        };

        pushKeyVal('Shipper Name', shipment.shipperName);
        pushKeyVal('Shipper Address', shipment.shipperAddress);
        pushKeyVal('Receiver Name', shipment.receiverName);
        pushKeyVal('Receiver Address', shipment.receiverAddress);
        pushKeyVal('Origin', shipment.origin);
        pushKeyVal('Destination', shipment.destination);
        pushKeyVal('Carrier', shipment.carrier || '-');
        pushKeyVal('Shipment Type', shipment.shipmentType || '-');
        pushKeyVal('Shipment Mode', shipment.shipmentMode || '-');
        pushKeyVal('Weight (kg)', shipment.weight ?? '-');
        doc.moveDown();

        // --- Packages ---
        if (Array.isArray(shipment.packages) && shipment.packages.length > 0) {
            doc.fontSize(14).fillColor('#1E3A8A').text('Package Breakdown', { underline: true });
            doc.moveDown(0.5);
            shipment.packages.forEach((pkg, i) => {
                doc.fontSize(11).fillColor('#000').text(`📦 Package ${i + 1}`);
                doc.fontSize(10).fillColor('gray').text(`   - Quantity: ${pkg.quantity ?? '-'}`);
                doc.text(`   - Type: ${pkg.pieceType ?? '-'}`);
                doc.text(`   - Dimensions: ${pkg.dimensions ?? '-'}`);
                doc.text(`   - Weight: ${pkg.weight ?? '-'}`);
                doc.moveDown(0.3);
            });
        }

        doc.addPage();

        // --- History Timeline ---
        if (Array.isArray(shipment.history) && shipment.history.length > 0) {
            doc.fontSize(16).fillColor('#1E3A8A').text('Shipment History', { underline: true });
            doc.moveDown(1);
            shipment.history.forEach((h, i) => {
                doc.fontSize(11).fillColor('#000').text(`${i + 1}. ${h.date || '-'} ${h.time || ''}`);
                doc.fontSize(10).fillColor('gray').text(`   Status: ${h.status || '-'}`);
                doc.text(`   Location: ${h.location || '-'}`);
                doc.text(`   Updated By: ${h.updatedBy || '-'}`);
                doc.text(`   Remarks: ${h.remarks || '-'}`);
                doc.moveDown(0.4);
            });
        }

        // Footer
        doc.addPage();
        doc.fontSize(10).fillColor('gray').text(
            'This document was generated by Starwood Express Logistics Shipping System.',
            { align: 'center' }
        );
        doc.moveDown(0.5);
        doc.fontSize(8).text(`© ${new Date().getFullYear()} Starwood Express Logistics. All Rights Reserved.`, { align: 'center' });

        doc.end();
    } catch (err) {
        console.error('PDF generation error:', err);
        return res.status(500).json({ error: 'Failed to generate PDF' });
    }
});


export default router;
