const express = require("express");
const cors = require("cors");
const http = require("http");
const axios = require("axios");
const { Server } = require("socket.io");
const { BakongKHQR, khqrData, MerchantInfo } = require("bakong-khqr");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

console.log("\n🚀 STARTING SERVER...");

// --- 1. CONFIGURATION (LOAD FROM RENDER) ---
// We trust Render variables 100% now. No defaults.
const TOKEN = process.env.BAKONG_TOKEN;
const MERCHANT_ID = process.env.BAKONG_MERCHANT_ID; 
const API_URL = process.env.BAKONG_API_URL || "https://api-bakong.nbc.gov.kh/v1/check_transaction_by_md5";

// Startup Check
if (!TOKEN || !MERCHANT_ID) {
    console.error("❌ FATAL ERROR: Missing Variables in Render!");
    console.error("   - BAKONG_TOKEN: " + (TOKEN ? "✅ Set" : "❌ Missing"));
    console.error("   - BAKONG_MERCHANT_ID: " + (MERCHANT_ID ? "✅ Set" : "❌ Missing"));
    process.exit(1); // Stop server if config is wrong
}

console.log(`✅ Using Merchant ID: [ ${MERCHANT_ID} ]`);

// 2. Generate QR Code
app.post("/api/generate-qr", (req, res) => {
    try {
        const amount = 500;
        const billNumber = "#" + Date.now().toString().slice(-6);
        const expireTime = Date.now() + 5 * 60 * 1000; // 5 mins

        const optionalData = {
            currency: khqrData.currency.khr,
            amount: amount,
            billNumber: billNumber,
            mobileNumber: "85512345678",
            storeLabel: "My Store",
            terminalLabel: "POS 001",
            expirationTimestamp: expireTime,
        };

        const merchantInfo = new MerchantInfo(
            MERCHANT_ID, // Uses your real ID from Render
            "My Store", 
            "Phnom Penh", 
            "MERCHANT001", 
            "DEV_BANK", 
            optionalData
        );

        const khqr = new BakongKHQR();
        const response = khqr.generateMerchant(merchantInfo);

        if (!response || !response.data) {
            console.error("❌ QR Gen Failed: Library returned null");
            return res.status(500).json({ error: "QR Generation Failed" });
        }

        const { qr: qrString, md5 } = response.data;
        console.log(`\n✅ QR Generated | Bill: ${billNumber}`);

        res.json({ qrString, md5, billNumber, expireTime });

    } catch (error) {
        console.error("❌ Generator Error:", error.message);
        res.status(500).json({ error: "Server Error" });
    }
});

// 3. Check Status
app.post("/api/check-status", async (req, res) => {
    const { md5 } = req.body;
    try {
        const response = await axios.post(
            API_URL,
            { md5: md5 }, 
            {
                headers: {
                    'Authorization': `Bearer ${TOKEN.trim()}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (response.data && response.data.responseCode === 0) {
            console.log(`\n🎉 SUCCESS! Payment Verified: ${md5}`);
            io.emit("payment-success", { md5, billNumber: "Paid" });
            return res.json({ status: "success" });
        } 
        
        return res.json({ status: "pending" });

    } catch (error) {
        // Ignore "Not Found" errors (User hasn't paid yet)
        if (error.response && error.response.data && error.response.data.errorCode === 15) {
            return res.json({ status: "pending" });
        }

        // Log real errors
        console.error(`❌ API Error: ${error.response ? error.response.status : error.message}`);
        
        if (error.response && error.response.status === 403) {
            console.error(`⚠️ 403 Forbidden: ID Mismatch. Check Render Variables.`);
        }

        return res.json({ status: "pending" });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));