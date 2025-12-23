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

// --- 1. CONFIGURATION ---
const TOKEN = process.env.BAKONG_TOKEN;
const API_URL = process.env.BAKONG_API_URL || "https://api-bakong.nbc.gov.kh/v1/check_transaction_by_md5";

// Load ID from Env
let MERCHANT_ID = process.env.BAKONG_MERCHANT_ID;

// 🛡️ CRASH PROTECTION: Check if ID is valid
// The library fails if ID is a UUID (no '@' symbol or too long/random)
if (!MERCHANT_ID || MERCHANT_ID.length > 20 || !MERCHANT_ID.includes("@")) {
    console.warn("⚠️ WARNING: Your BAKONG_MERCHANT_ID looks invalid (it might be a UUID).");
    console.warn("   - You provided: " + MERCHANT_ID);
    console.warn("   - Resetting to default 'sokpheak_vong@bkrt' to prevent crash.");
    
    // Fallback to prevent "returned null" error
    MERCHANT_ID = "sokpheak_vong@bkrt"; 
}

console.log(`✅ Using Merchant ID: [ ${MERCHANT_ID} ]`);

// 2. Generate QR Code
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
            storeLabel: "My Store",
            terminalLabel: "POS 001",
            expirationTimestamp: expireTime,
        };

        const merchantInfo = new MerchantInfo(
            MERCHANT_ID, // Use the sanitized ID
            "My Store", 
            "Phnom Penh", 
            "MERCHANT001", 
            "DEV_BANK", 
            optionalData
        );

        const khqr = new BakongKHQR();
        const response = khqr.generateMerchant(merchantInfo);

        if (!response || !response.data) {
            console.error("❌ KHQR Library returned null data.");
            return res.status(500).json({ error: "QR Generation Failed - Invalid Merchant ID" });
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
        if (error.response && error.response.data && error.response.data.errorCode === 15) {
            return res.json({ status: "pending" });
        }
        
        console.error(`❌ API Error: ${error.response ? error.response.status : error.message}`);

        if (error.response && error.response.status === 403) {
            console.error(`⚠️ 403 Forbidden: Your Token cannot check bills for ${MERCHANT_ID}`);
            console.error(`👉 ACTION: You must find the Account ID (username@bkrt) that belongs to your token.`);
        }

        return res.json({ status: "pending" });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));