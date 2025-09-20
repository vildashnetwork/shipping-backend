import mongoose from "mongoose";

const adminschema = new mongoose.Schema(
    {
        email: {
            type: String,
            required: true
        },
        password: {
            type: String,
            required: true
        }
    },
    { timestamps: true }
)

const adminModel = mongoose.model("Admin", adminschema)

export default adminModel