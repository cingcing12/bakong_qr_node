require("dotenv").config();

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
const io = new Server(server, {
  cors: { origin: "*" }, // allow all origins
  transports: ["websocket"], // force websocket for HTTPS
});

console.log("🚀 STARTING BAKONG KHQR SERVER...");

const TOKEN = process.env.BAKONG_TOKEN?.trim() || null;
const MERCHANT_ID = process.env.BAKONG_MERCHANT_ID || null;
const API_URL =
  process.env.BAKONG_API_URL || "https://api-bakong.nbc.gov.kh/v1/check_transaction_by_md5";

const BAKONG_ENABLED = !!(TOKEN && MERCHANT_ID);
console.log("🔐 Bakong Enabled:", BAKONG_ENABLED);

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", bakongEnabled: BAKONG_ENABLED });
});

// Generate QR
app.post("/api/generate-qr", (req, res) => {
  try {
    const amount = 500;
    const billNumber = "INV-" + Date.now();
    const expireTime = Date.now() + 5 * 60 * 1000;

    const merchantInfo = new MerchantInfo(
      MERCHANT_ID || "DEV_MERCHANT",
      "My Store",
      "Phnom Penh",
      "POS001",
      "DEV_BANK",
      {
        currency: khqrData.currency.khr,
        amount,
        billNumber,
        storeLabel: "My Store",
        terminalLabel: "POS001",
        expirationTimestamp: expireTime,
      }
    );

    const khqr = new BakongKHQR();
    const result = khqr.generateMerchant(merchantInfo);

    if (!result?.data) return res.status(500).json({ error: "KHQR generation failed" });

    const { qr, md5 } = result.data;
    res.json({ qrString: qr, md5, billNumber, expireTime, bakongEnabled: BAKONG_ENABLED });
  } catch (err) {
    console.error("❌ QR ERROR:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Check payment status
app.post("/api/check-status", async (req, res) => {
  if (!BAKONG_ENABLED) return res.json({ status: "pending" });

  const { md5 } = req.body;
  if (!md5) return res.status(400).json({ error: "md5 required" });

  try {
    const response = await axios.post(
      API_URL,
      { md5, merchantId: MERCHANT_ID },
      { headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, timeout: 10000 }
    );

    if (response.data?.responseCode === 0) {
      io.sockets.emit("payment-success", { md5 }); // emit to all clients
      return res.json({ status: "success" });
    }

    return res.json({ status: "pending" });
  } catch (err) {
    return res.json({ status: "pending" });
  }
});

// Test socket (debug only)
app.get("/api/test-socket", (req, res) => {
  io.sockets.emit("payment-success", { md5: "test123" });
  res.send("Socket test emitted");
});

// Socket connection
io.on("connection", (socket) => {
  console.log("🔌 Client connected");
  socket.on("disconnect", () => console.log("Client disconnected"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
