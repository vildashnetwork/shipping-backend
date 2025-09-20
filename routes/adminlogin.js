import express from "express";
import bcrypt from "bcryptjs"; // for hashing passwords
import jwt from "jsonwebtoken"; // for login tokens
import adminModel from "../models/admin.js";

const router = express.Router();

// REGISTER ADMIN
router.post("/register", async (req, res) => {
    try {
        const { email, password } = req.body;

        // check if account exists
        const existingAdmin = await adminModel.findOne({ email });
        if (existingAdmin) {
            return res.status(400).json({ message: "This account already exists" });
        }

        // hash password
        const hashedPassword = await bcrypt.hash(password, 10);
   
        // save admin
        const newAdmin = new adminModel({ email, password: hashedPassword });
        await newAdmin.save();
 const token = jwt.sign({ id: newAdmin._id }, process.env.JWT_SECRET, {
            expiresIn: "1d",
        });
        res.status(201).json({ message: "Registration successful",token: token });
    } catch (error) {
        console.error("Register Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// LOGIN ADMIN
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        // check if account exists
        const admin = await adminModel.findOne({ email });
        if (!admin) {
            return res.status(404).json({ message: "Account not found" });
        }

        // verify password
        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        // generate JWT token
        const token = jwt.sign({ id: admin._id }, process.env.JWT_SECRET, {
            expiresIn: "1d",
        });

        res.status(200).json({ message: "Login successful", token });
    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// DELETE ALL ADMINS (⚠️ for testing only!)
router.delete("/del", async (req, res) => {
    try {
        await adminModel.deleteMany();
        res.status(200).json({ message: "All admins deleted" });
    } catch (error) {
        console.error("Delete Error:", error);
        res.status(500).json({ message: "Error deleting admins" });
    }
});

export default router;
