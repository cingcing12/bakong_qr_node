const express = require("express");
const cors = require("cors");
const http = require("http");
const axios = require("axios");
const { Server } = require("socket.io");
const { BakongKHQR, khqrData, MerchantInfo } = require("bakong-khqr");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- CONFIGURATION ---
const BAKONG_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkYXRhIjp7ImlkIjoiMTgxMTVhM2M2MjUxNDhiZiJ9LCJpYXQiOjE3NjY0NTQyNjMsImV4cCI6MTc3NDIzMDI2M30.K2HHJNf6CuAuSQmrJ0l6-yFTBL6IbXFQOF_NI0DV0WU";

// 🏆 CORRECT ENDPOINT FROM YOUR PDF
const BAKONG_API_URL = "https://api-bakong.nbc.gov.kh/v1/check_transaction_by_md5"; 

// 1. Generate QR Code
app.post("/api/generate-qr", (req, res) => {
    try {
        const amount = 500;
        const billNumber = "#" + Date.now().toString().slice(-6);
        const expireTime = Date.now() + 5 * 60 * 1000; 

        const optionalData = {
            currency: khqrData.currency.khr,
            amount: amount,
            billNumber: billNumber,
            mobileNumber: "85512345678",
            storeLabel: "Sokpheak Store",
            terminalLabel: "POS 001",
            expirationTimestamp: expireTime,
        };

        const merchantInfo = new MerchantInfo(
            "sokpheak_vong@bkrt", "Sokpheak Store", "Phnom Penh", 
            "MERCHANT001", "DEV_BANK", optionalData
        );

        const khqr = new BakongKHQR();
        const response = khqr.generateMerchant(merchantInfo);

        if (!response || !response.data) return res.status(500).json({ error: "Failed" });

        const { qr: qrString, md5 } = response.data;

        console.log(`\n✅ NEW QR GENERATED`);
        console.log(`🧾 Bill: ${billNumber}`);
        console.log(`🔑 MD5: ${md5}`);

        res.json({ qrString, md5, billNumber, expireTime });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server Error" });
    }
});

// 2. Check Status (Using Correct Endpoint & Key)
app.post("/api/check-status", async (req, res) => {
    const { md5 } = req.body;

    try {
        // ALWAYS ask Bakong using the correct endpoint
        const response = await axios.post(
            BAKONG_API_URL,
            { md5: md5 }, // ⚠️ The doc says the key MUST be "md5"
            {
                headers: {
                    'Authorization': `Bearer ${BAKONG_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        // Debug Log: See exactly what Bakong answers
        // console.log("Bakong Reply:", response.data);

        // Success Case (Response Code 0 means Success)
        if (response.data && response.data.responseCode === 0) {
            console.log(`\n🎉 SUCCESS! Payment Verified for: ${md5}`);
            io.emit("payment-success", { md5, billNumber: "Paid" });
            return res.json({ status: "success" });
        } 
        
        return res.json({ status: "pending" });

    } catch (error) {
        // Handle "Not Found" error gracefully (user hasn't paid yet)
        if (error.response && error.response.data && error.response.data.errorCode === 15) {
            return res.json({ status: "pending" });
        }

        console.log(`\n❌ API Error: ${error.response ? error.response.status : error.message}`);
        return res.json({ status: "pending" });
    }
});

const PORT = 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));