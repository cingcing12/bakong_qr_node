const express = require("express");
const cors = require("cors");
const http = require("http");
const axios = require("axios");
const { Server } = require("socket.io");
const { BakongKHQR, khqrData, MerchantInfo } = require("bakong-khqr");
const jwt = require("jsonwebtoken"); 
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

// PRIORITY 1: Use Manual ID from Render (Safe)
// PRIORITY 2: Use Tutorial ID (Fails 403, but generates QR)
let ACTIVE_MERCHANT_ID = process.env.BAKONG_MERCHANT_ID || "sokpheak_vong@bkrt";

// LOGGING FOR DEBUGGING
if (!TOKEN) {
    console.error("❌ FATAL: BAKONG_TOKEN is missing!");
} else {
    // We log the Token ID just for your info, but we won't force-use it if it breaks things
    try {
        const decoded = jwt.decode(TOKEN);
        if (decoded && decoded.data && decoded.data.id) {
            console.log(`ℹ️  ID found in Token: [ ${decoded.data.id} ]`);
            
            // OPTIONAL: Only switch to Token ID if user didn't set a manual one
            if (!process.env.BAKONG_MERCHANT_ID) {
                 console.log("⚠️ No Manual ID set. Trying Token ID...");
                 ACTIVE_MERCHANT_ID = decoded.data.id;
            }
        }
    } catch (e) { console.error("⚠️ Token decode error."); }
}

console.log(`✅ USING MERCHANT ID: [ ${ACTIVE_MERCHANT_ID} ]`);

// 2. Generate QR Code
app.post("/api/generate-qr", (req, res) => {
    try {
        const amount = 500;
        const billNumber = "#" + Date.now().toString().slice(-6);
        const expireTime = Date.now() + 5 * 60 * 1000; 

        // DEBUG: Log inputs to see why library might fail
        console.log(`\n⚙️ Generating QR for: ${ACTIVE_MERCHANT_ID}`);

        const merchantInfo = new MerchantInfo(
            ACTIVE_MERCHANT_ID, 
            "My Store", 
            "Phnom Penh", 
            "MERCHANT001", 
            "DEV_BANK", 
            {
                currency: khqrData.currency.khr,
                amount: amount,
                billNumber: billNumber,
                mobileNumber: "85512345678",
                storeLabel: "My Store",
                terminalLabel: "POS 001",
                expirationTimestamp: expireTime,
            }
        );

        const khqr = new BakongKHQR();
        const response = khqr.generateMerchant(merchantInfo);

        // ERROR TRAPPING
        if (!response || !response.data) {
            console.error("❌ KHQR FAILED. Library returned null.");
            console.error("   Reason: The Merchant ID might be invalid format.");
            console.error(`   Bad ID: "${ACTIVE_MERCHANT_ID}"`);
            return res.status(500).json({ error: "Invalid Merchant ID format" });
        }

        const { qr: qrString, md5 } = response.data;
        console.log(`✅ QR CREATED! Bill: ${billNumber}`);

        res.json({ qrString, md5, billNumber, expireTime });

    } catch (error) {
        console.error("❌ CRITICAL ERROR:", error);
        res.status(500).json({ error: error.message });
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
                    'Authorization': `Bearer ${TOKEN ? TOKEN.trim() : ''}`,
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
        if (error.response && error.response.status === 403) {
            console.error(`⚠️ 403 FORBIDDEN: Token cannot check ID: ${ACTIVE_MERCHANT_ID}`);
        }
        return res.json({ status: "pending" });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));