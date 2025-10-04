// import mongoose from 'mongoose';
// const { Schema } = mongoose;

// // Package Schema
// const PackageSchema = new Schema({
//     quantity: { type: Number, required: true },
//     pieceType: { type: String, required: true },
//     description: { type: String, required: true },
//     dimensions: { type: String },
//     weight: { type: Number, required: true },
// });

// // Shipment History Schema
// const HistorySchema = new Schema({
//     date: { type: String, required: true },
//     time: { type: String, required: true },
//     location: { type: String },
//     status: { type: String, required: true },
//     updatedBy: { type: String, required: true },
//     remarks: { type: String },
// });

// // Shipment Schema
// const ShipmentSchema = new Schema({
//     trackingNumber: { type: String, required: true, unique: true },
//     shipperName: { type: String, required: true },
//     shipperAddress: { type: String, required: true },
//     receiverName: { type: String, required: true },
//     receiverAddress: { type: String, required: true },
//     status: {
//         type: String,
//         enum: ['Processing', 'In Transit', 'Out for Delivery', 'Delivered'],
//         default: 'Processing'
//     },
//     origin: { type: String, required: true },
//     destination: { type: String, required: true },
//     carrier: { type: String },
//     shipmentType: {
//         type: String,
//         enum: ['Truckload', 'Air', 'Ocean', 'Road', 'Express'],
//         default: 'Road'
//     },
//     packageCount: { type: Number, default: 1 },
//     weight: { type: Number, default: 0 },
//     shipmentMode: { type: String },
//     carrierReferenceNo: { type: String },
//     productName: { type: String },
//     quantity: { type: Number, default: 1 },
//     paymentMode: {
//         type: String,
//         enum: ['Cash', 'Bank', 'Venmo', 'Credit Card', 'PayPal'],
//         default: 'Cash'
//     },
//     freightCost: { type: Number, default: 0 },
//     expectedDeliveryDate: { type: String },
//     departureTime: { type: String },
//     pickupDate: { type: String },
//     pickupTime: { type: String },
//     comments: { type: String },
//     packages: [PackageSchema],
//     history: [HistorySchema],
//     createdAt: { type: String, default: () => new Date().toISOString() },
//     updatedAt: { type: String, default: () => new Date().toISOString() },
// });

// const Shipment = mongoose.model('Shipment', ShipmentSchema);
// export default Shipment;









import mongoose from 'mongoose';
const { Schema } = mongoose;

// Package Schema
const PackageSchema = new Schema({
    quantity: { type: String, required: true },
    pieceType: { type: String, required: true },
    description: { type: String, required: true },
    dimensions: { type: String },
    weight: { type: String, required: true },
});

// Shipment History Schema
const HistorySchema = new Schema({
    date: { type: String, required: true },
    time: { type: String, required: true },
    location: { type: String },
    status: { type: String, required: true },
    updatedBy: { type: String, required: true },
    remarks: { type: String },
});

// Shipment Schema
const ShipmentSchema = new Schema({
    trackingNumber: { type: String, required: true, unique: true},
    shipperName: { type: String, required: true },
    shipperAddress: { type: String, required: true },
    receiverName: { type: String, required: true },
    receiverAddress: { type: String, required: true },
    status: {
        type: String,
        enum: ['Processing', 'In Transit', 'Out for Delivery', 'Delivered'],
        default: 'Processing'
    },
    origin: { type: String, required: true },
    destination: { type: String, required: true },
    carrier: { type: String },
    shipmentType: {
        type: String,
        enum: ['Truckload', 'Air', 'Ocean', 'Road', 'Express'],
        default: 'Road'
    },
    packageCount: { type: String, default: 1 },
    weight: { type: String, default: 0 },
    shipmentMode: { type: String },
    carrierReferenceNo: { type: String },
    productName: { type: String },
    quantity: { type: String, default: 1 },
    paymentMode: {
        type: String,
        enum: ['Cash', 'Bank', 'Venmo', 'Credit Card', 'PayPal'],
        default: 'Cash'
    },
    freightCost: { type: String, default: 0 },
    expectedDeliveryDate: { type: String },
    departureTime: { type: String },
    pickupDate: { type: String },
    pickupTime: { type: String },
    comments: { type: String },
    packages: [PackageSchema],
    history: [HistorySchema],
    createdAt: { type: String, default: () => new Date().toISOString() },
    updatedAt: { type: String, default: () => new Date().toISOString() },
});

const Shipment = mongoose.model('Shipment', ShipmentSchema);
export default Shipment;
