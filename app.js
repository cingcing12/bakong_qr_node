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

// --- 1. SAFETY CHECK (RUNS ON STARTUP) ---
console.log("\n🚀 STARTING SERVER...");
console.log("---------------------------------------------------");
if (!process.env.BAKONG_TOKEN) {
    console.error("❌ FATAL ERROR: BAKONG_TOKEN is missing from Environment Variables!");
    console.error("👉 Go to Render Dashboard -> Environment -> Add BAKONG_TOKEN");
} else {
    const token = process.env.BAKONG_TOKEN;
    console.log("✅ BAKONG_TOKEN Loaded.");
    console.log(`🔍 Token Length: ${token.length} chars`);
    console.log(`👀 First 10 chars: ${token.substring(0, 10)}...`);
    
    // Check for invisible spaces
    if (token.trim() !== token) {
        console.error("⚠️ WARNING: Your token has hidden spaces at the start or end! Please remove them in Render.");
    }
}
console.log("---------------------------------------------------");


// --- CONFIGURATION ---
// Use defaults if variables are missing to prevent crashes, but warn user
const BAKONG_API_URL = process.env.BAKONG_API_URL || "https://api-bakong.nbc.gov.kh/v1/check_transaction_by_md5";
const MERCHANT_ID = process.env.BAKONG_MERCHANT_ID || "sokpheak_vong@bkrt"; 

// 2. Generate QR Code Route
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
            MERCHANT_ID, 
            "Sokpheak Store", 
            "Phnom Penh", 
            "MERCHANT001", 
            "DEV_BANK", 
            optionalData
        );

        const khqr = new BakongKHQR();
        const response = khqr.generateMerchant(merchantInfo);

        if (!response || !response.data) return res.status(500).json({ error: "Failed to generate QR" });

        const { qr: qrString, md5 } = response.data;

        console.log(`\n✅ QR GENERATED | Bill: ${billNumber} | MD5: ${md5}`);

        res.json({ qrString, md5, billNumber, expireTime });

    } catch (error) {
        console.error("QR Gen Error:", error.message);
        res.status(500).json({ error: "Server Error" });
    }
});

// 3. Check Status Route
app.post("/api/check-status", async (req, res) => {
    const { md5 } = req.body;

    // Fail fast if token is missing
    if (!process.env.BAKONG_TOKEN) {
        console.error("❌ Cannot check status: Token is missing!");
        return res.status(500).json({ status: "error", message: "Server misconfigured" });
    }

    try {
        const response = await axios.post(
            BAKONG_API_URL,
            { md5: md5 }, 
            {
                headers: {
                    'Authorization': `Bearer ${process.env.BAKONG_TOKEN.trim()}`, // .trim() removes accidental spaces
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
        // Handle "Not Found" / Code 15 (Not paid yet)
        if (error.response && error.response.data && error.response.data.errorCode === 15) {
            return res.json({ status: "pending" });
        }

        // Log actual errors (401, 403, 500)
        console.error(`❌ API Error: ${error.response ? error.response.status : error.message}`);
        
        if (error.response && error.response.status === 403) {
            console.error("⚠️ HINT: 403 means your Token is invalid, expired, or blocked.");
        }

        return res.json({ status: "pending" });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));