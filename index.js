import e from "express";
import dotenv from "dotenv"
import mongoose from "mongoose";
import cors from "cors"
import adminlogin from "./routes/adminlogin.js"
import shipments from "./routes/shipment.js"
import tracking from "./routes/tracking.js";

dotenv.config()
const app = e();

app.use(e.json())
app.use(cors())

app.use("/tracking", tracking)
app.use("/shipments", shipments)
app.use("/auth", adminlogin)

const connect = async () => {
    try {
        const res = await mongoose.connect(process.env.MONGO_URI)
        if (res) {
            console.log('====================================');
            console.log("database connected sucessfully");
            console.log('====================================');
        }
    } catch (error) {
        console.log('====================================');
        console.log(error);
        console.log('====================================');
    }
}
const PORT = 6000 || process.env.PORT

connect().then(() => {
    app.listen(PORT, () => {
        try {
            console.log("server running on http://localhost:6000")
        } catch (error) {
            console.log('====================================');
            console.log(error);
            console.log('====================================');
        }
    })
})
