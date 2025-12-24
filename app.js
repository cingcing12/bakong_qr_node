require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const axios = require("axios");
const { Server } = require("socket.io");
const { BakongKHQR, khqrData, IndividualInfo } = require("bakong-khqr");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["polling", "websocket"]
});

const TOKEN = process.env.BAKONG_TOKEN?.trim();
const MERCHANT_ID = process.env.BAKONG_MERCHANT_ID?.trim();
const CHECK_API = "https://api-bakong.nbc.gov.kh/v1/check_transaction_by_md5";
const BAKONG_ENABLED = !!(TOKEN && MERCHANT_ID);

console.log("🔐 Bakong Enabled:", BAKONG_ENABLED);

/* ================= SOCKET ================= */
io.on("connection", (socket) => {
  console.log("🔌 Client connected");
  socket.on("join-payment", (md5) => socket.join(md5));
  socket.on("disconnect", () => console.log("❌ Client disconnected"));
});

/* ================= GENERATE QR ================= */
app.post("/api/generate-qr", (req, res) => {
  try {
    const amount = 500; // Or get from req.body
    const expireTime = Date.now() + 5 * 60 * 1000; // 5 minutes
    const billNumber = "INV-" + Date.now();

    const optionalData = {
      currency: khqrData.currency.khr,
      amount,
      billNumber,
      storeLabel: "Vong Sokpheak",
      terminalLabel: "Pheak Terminal",
      expirationTimestamp: expireTime
    };

    const individualInfo = new IndividualInfo(
      "sokpheak_vong@bkrt",
      "Vong Sokpheak",
      "Phnom Penh",
      optionalData
    );

    const khqr = new BakongKHQR();
    const response = khqr.generateIndividual(individualInfo);

    if (response.status.code !== 0) throw new Error(response.status.message);

    const KHQRString = response.data.qr;
    const md5 = response.data.md5;

    // Send QR string and md5 to frontend
    res.json({ qrString: KHQRString, md5, expireTime });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "QR generation failed" });
  }
});

/* ================= CHECK PAYMENT ================= */
app.post("/api/check-status", async (req, res) => {
  if (!BAKONG_ENABLED) return res.json({ status: "pending" });

  const { md5 } = req.body;
  if (!md5) return res.status(400).json({ error: "md5 required" });

  try {
    const r = await axios.post(
      CHECK_API,
      { md5, merchantId: MERCHANT_ID },
      { headers: { Authorization: `Bearer ${TOKEN}` }, timeout: 10000 }
    );

    if (r.data?.responseCode === 0) {
      io.to(md5).emit("payment-success", { md5 });
      return res.json({ status: "success" });
    }

    res.json({ status: "pending" });
  } catch (err) {
    res.json({ status: "pending" });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
