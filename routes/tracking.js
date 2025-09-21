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
            scale: 3,
            height: 50,
            includetext: false,
            paddingwidth: 10,
            paddingheight: 10
        });

        // Create QR code buffer
        const publicTrackingUrl =
            (process.env.PUBLIC_TRACKING_URL || `${req.protocol}://${req.get('host')}/track?code=${encodeURIComponent(shipment.trackingNumber)}`);
        const qrBuffer = await QRCode.toBuffer(publicTrackingUrl, {
            type: 'png',
            margin: 1,
            width: 120,
            color: {
                dark: '#003366', // Starwood Express dark blue
                light: '#FFFFFF'
            }
        });

        // Prepare PDF response headers
        const filenameSafe = (shipment.trackingNumber || code).replace(/[^a-z0-9\-_\.]/gi, '-');
        res.setHeader('Content-Disposition', `inline; filename="${filenameSafe}.pdf"`);
        res.setHeader('Content-Type', 'application/pdf');

        // Create PDF with larger margins for professional appearance
        const doc = new PDFDocument({
            size: 'A4',
            margin: 50,
            info: {
                Title: `Shipment Details - ${shipment.trackingNumber}`,
                Author: 'Starwood Express Logistics',
                Subject: 'Shipment Documentation'
            }
        });

        // Stream PDF to response
        doc.pipe(res);

        // Company branding header
        doc.rect(0, 0, doc.page.width, 80)
            .fill('#003366'); // Starwood Express dark blue

        // Company name (consider adding a logo image if available)
        doc.fontSize(20)
            .font('Helvetica-Bold')
            .fillColor('#FFFFFF')
            .text('STARWOOD EXPRESS LOGISTICS', 50, 30, { align: 'left' });

        doc.fontSize(10)
            .fillColor('#CCCCCC')
            .text('Global Logistics Solutions', 50, 55, { align: 'left' });

        // Document title and generation info
        doc.fontSize(16)
            .font('Helvetica-Bold')
            .fillColor('#333333')
            .text('SHIPMENT DETAILS', 50, 100, { align: 'left' });

        doc.fontSize(9)
            .font('Helvetica')
            .fillColor('#666666')
            .text(`Generated: ${new Date().toLocaleString()} | Document ID: ${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
                50, 120, { align: 'left' });

        // Horizontal line separator
        doc.moveTo(50, 140)
            .lineTo(doc.page.width - 50, 140)
            .strokeColor('#DDDDDD')
            .stroke();

        // Main content area
        const leftCol = 50;
        const rightCol = 320;
        const topStart = 160;

        // Left column - Tracking information
        doc.fontSize(12)
            .font('Helvetica-Bold')
            .fillColor('#003366')
            .text('TRACKING INFORMATION', leftCol, topStart);

        doc.fontSize(10)
            .font('Helvetica')
            .fillColor('#333333');

        // Tracking info in a clean layout
        const infoTop = topStart + 25;
        doc.text('Tracking Number:', leftCol, infoTop);
        doc.font('Helvetica-Bold').text(shipment.trackingNumber || '-', leftCol + 90, infoTop);

        doc.font('Helvetica').text('Status:', leftCol, infoTop + 20);
        // Color code based on status
        const statusColor =
            shipment.status === 'Delivered' ? '#28a745' :
                shipment.status === 'In Transit' ? '#17a2b8' :
                    shipment.status === 'Exception' ? '#dc3545' : '#6c757d';
        doc.font('Helvetica-Bold').fillColor(statusColor).text(shipment.status || '-', leftCol + 90, infoTop + 20);
        doc.fillColor('#333333');

        doc.font('Helvetica').text('Expected Delivery:', leftCol, infoTop + 40);
        doc.font('Helvetica-Bold').text(shipment.expectedDeliveryDate || shipment.estimatedDelivery || '-', leftCol + 90, infoTop + 40);

        // Barcode and QR code section
        const codesTop = infoTop + 70;
        doc.image(barcodeBuffer, leftCol, codesTop, { width: 200 });
        doc.image(qrBuffer, leftCol + 220, codesTop - 10, { width: 100, height: 100 });

        doc.fontSize(8)
            .font('Helvetica')
            .fillColor('#666666')
            .text('Scan QR code for real-time tracking', leftCol + 220, codesTop + 95, { width: 100, align: 'center' });

        // Right column - Shipment overview
        doc.fontSize(12)
            .font('Helvetica-Bold')
            .fillColor('#003366')
            .text('SHIPMENT OVERVIEW', rightCol, topStart);

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
            doc.font('Helvetica-Bold').fillColor('#333333').text(item.value, rightCol + 70, yPos);
        });

        // Shipper and Receiver information
        const detailsTop = codesTop + 120;
        doc.fontSize(12)
            .font('Helvetica-Bold')
            .fillColor('#003366')
            .text('SHIPPER INFORMATION', leftCol, detailsTop);

        doc.fontSize(10)
            .font('Helvetica')
            .fillColor('#333333')
            .text(shipment.shipperName || '-', leftCol, detailsTop + 20)
            .text(shipment.shipperAddress || '-', leftCol, detailsTop + 35, { width: 240 });

        doc.fontSize(12)
            .font('Helvetica-Bold')
            .fillColor('#003366')
            .text('RECEIVER INFORMATION', rightCol, detailsTop);

        doc.fontSize(10)
            .font('Helvetica')
            .fillColor('#333333')
            .text(shipment.receiverName || '-', rightCol, detailsTop + 20)
            .text(shipment.receiverAddress || '-', rightCol, detailsTop + 35, { width: 240 });

        // Additional shipment details
        const additionalTop = detailsTop + 80;
        doc.fontSize(12)
            .font('Helvetica-Bold')
            .fillColor('#003366')
            .text('ADDITIONAL DETAILS', leftCol, additionalTop);

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
            doc.font('Helvetica-Bold').fillColor('#333333').text(item.value, leftCol + 80, yPos);
        });

        // Package details table
        if (Array.isArray(shipment.packages) && shipment.packages.length > 0) {
            const packagesTop = additionalTop + 100;
            doc.fontSize(12)
                .font('Helvetica-Bold')
                .fillColor('#003366')
                .text('PACKAGE DETAILS', leftCol, packagesTop);

            // Table header
            doc.fontSize(9)
                .fillColor('#FFFFFF')
                .rect(leftCol, packagesTop + 15, 510, 20)
                .fill('#003366');

            doc.text('Type', leftCol + 10, packagesTop + 20);
            doc.text('Description', leftCol + 80, packagesTop + 20);
            doc.text('Dimensions', leftCol + 250, packagesTop + 20);
            doc.text('Weight', leftCol + 350, packagesTop + 20);
            doc.text('Qty', leftCol + 420, packagesTop + 20);

            // Table rows
            let tableY = packagesTop + 35;
            shipment.packages.forEach((pkg, idx) => {
                // Alternate row colors
                if (idx % 2 === 0) {
                    doc.rect(leftCol, tableY, 510, 20)
                        .fill('#F8F9FA');
                }

                doc.fontSize(9)
                    .font('Helvetica')
                    .fillColor('#333333')
                    .text(pkg.pieceType || '-', leftCol + 10, tableY + 5)
                    .text(pkg.description || '-', leftCol + 80, tableY + 5, { width: 160 })
                    .text(pkg.dimensions || '-', leftCol + 250, tableY + 5, { width: 90 })
                    .text(pkg.weight ? `${pkg.weight} kg` : '-', leftCol + 350, tableY + 5)
                    .text(pkg.quantity ?? '-', leftCol + 420, tableY + 5);

                tableY += 20;
            });
        }

        // Shipment history
        if (Array.isArray(shipment.history) && shipment.history.length > 0) {
            doc.addPage();

            // Page header
            doc.fontSize(16)
                .font('Helvetica-Bold')
                .fillColor('#003366')
                .text('SHIPMENT HISTORY', 50, 80);

            doc.moveTo(50, 100)
                .lineTo(doc.page.width - 50, 100)
                .strokeColor('#DDDDDD')
                .stroke();

            // History items
            let historyY = 120;
            shipment.history.forEach((h, idx) => {
                if (historyY > doc.page.height - 100) {
                    doc.addPage();
                    historyY = 80;
                }

                // Timeline circle
                doc.circle(70, historyY + 10, 5)
                    .fill('#003366');

                if (idx < shipment.history.length - 1) {
                    // Timeline connector
                    doc.moveTo(70, historyY + 15)
                        .lineTo(70, historyY + 45)
                        .strokeColor('#CCCCCC')
                        .lineWidth(1)
                        .stroke();
                }

                // History content
                doc.fontSize(10)
                    .font('Helvetica-Bold')
                    .fillColor('#003366')
                    .text(h.status || 'Status update', 90, historyY);

                doc.fontSize(9)
                    .font('Helvetica')
                    .fillColor('#666666')
                    .text(`${h.date || ''} ${h.time || ''}`, 90, historyY + 15);

                doc.fontSize(9)
                    .fillColor('#333333')
                    .text(`Location: ${h.location || 'Not specified'}`, 90, historyY + 30, { width: 400 });

                if (h.remarks) {
                    doc.fontSize(8)
                        .fillColor('#666666')
                        .text(`Remarks: ${h.remarks}`, 90, historyY + 45, { width: 400 });
                    historyY += 60;
                } else {
                    historyY += 50;
                }
            });
        }

        // Footer on every page
        const addFooter = (page) => {
            doc.page = page;
            doc.fontSize(8)
                .font('Helvetica')
                .fillColor('#666666')
                .text(`Starwood Express Logistics • ${shipment.trackingNumber}`, 50, doc.page.height - 40, { align: 'left' })
                .text(`Page ${page.pageNumber} of ${doc.bufferedPageRange().count} • Generated: ${new Date().toLocaleString()}`, 50, doc.page.height - 40, { align: 'right' });

            // Confidential watermark
            doc.opacity(0.03)
                .fontSize(80)
                .font('Helvetica-Bold')
                .fillColor('#000000')
                .text('CONFIDENTIAL', doc.page.width / 2, doc.page.height / 2, { align: 'center', rotated: true })
                .opacity(1);
        };

        // Add footer to all pages
        doc.on('pageAdded', () => {
            const pages = doc.bufferedPageRange();
            for (let i = 0; i < pages.count; i++) {
                addFooter(doc);
            }
        });

        // Final footer
        doc.addPage();
        doc.fontSize(10)
            .font('Helvetica')
            .fillColor('#666666')
            .text('This document contains confidential information intended solely for the recipient.', 50, 100, { align: 'center', width: 500 });

        doc.fontSize(8)
            .text('© ' + new Date().getFullYear() + ' Starwood Express Logistics. All rights reserved.', 50, doc.page.height - 40, { align: 'center' });

        // Finalize PDF
        doc.end();

    } catch (err) {
        console.error('PDF generation error:', err);
        return res.status(500).json({ error: 'Failed to generate PDF' });
    }
});

export default router;
