import express from 'express';
import Shipment from '../models/shipmentschma.js'; // correct import

const router = express.Router();

// CREATE a new shipment
router.post('/', async (req, res) => {
    try {
        const shipment = new Shipment(req.body);
        await shipment.save();
        res.status(201).json({ message: 'Shipment created', shipment });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to create shipment' });
    }
});

// GET all shipments
router.get('/', async (req, res) => {
    try {
        const shipments = await Shipment.find();
        res.status(200).json(shipments);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch shipments' });
    }
});

// GET a single shipment by ID
router.get('/:id', async (req, res) => {
    try {
        const shipment = await Shipment.findById(req.params.id);
        if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
        res.status(200).json(shipment);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch shipment' });
    }
});

// UPDATE a shipment by ID
router.put('/:id', async (req, res) => {
    try {
        const updatedShipment = await Shipment.findByIdAndUpdate(
            req.params.id,
            { ...req.body, updatedAt: new Date().toISOString() },
            { new: true }
        );
        if (!updatedShipment) return res.status(404).json({ error: 'Shipment not found' });
        res.status(200).json({ message: 'Shipment updated', shipment: updatedShipment });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update shipment' });
    }
});

// DELETE a shipment by ID
router.delete('/:id', async (req, res) => {
    try {
        const deletedShipment = await Shipment.findByIdAndDelete(req.params.id);
        if (!deletedShipment) return res.status(404).json({ error: 'Shipment not found' });
        res.status(200).json({ message: 'Shipment deleted' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to delete shipment' });
    }
});

export default router;
