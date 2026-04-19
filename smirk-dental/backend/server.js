// ═══════════════════════════════════════════
// server.js — Smirk Dental Clinic Backend
// Node.js + Express + MongoDB
// ═══════════════════════════════════════════

require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const webhookRouter = require('./routes/webhook');
const cors = require("cors");


const { startScheduler } = require('./services/scheduler');
const appointmentsRouter = require('./routes/appointments');

const app = express();
const PORT = process.env.PORT || 5001;

const unavailableRouter = require('./routes/unavailable');

console.log("ENV:", process.env.MONGODB_URI);

function captureRawBody(req, res, buf) {
  req.rawBody = buf;
}

// ── SECURITY MIDDLEWARE ──
app.use(helmet({
  contentSecurityPolicy: false, // disable for API
}));

// ── CORS ──
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: [
    "https://smirk-clinic.vercel.app"
  ],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

// ── BODY PARSING ──
app.use(express.json({ limit: '256kb', verify: captureRawBody }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// WhatsApp Cloud API (needs parsed JSON + raw body for optional signature verify)
app.use('/webhook', webhookRouter);
app.use('/unavailable', unavailableRouter);

// ── RATE LIMITING ──
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' },
});

const bookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 5,                     // max 5 bookings per IP per hour
  message: { success: false, message: 'Booking limit reached. Please try again in an hour.' },
});

app.use('/api', apiLimiter);
app.use('/api/appointments', bookingLimiter);  // applied only to POST via POST check below

// ── MONGODB CONNECTION ──
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(
      process.env.MONGODB_URI || 'mongodb://localhost:27017/smirk_dental',
      {
        serverSelectionTimeoutMS: 5000,
      }
    );
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    await mongoose.connection.syncIndexes();
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  }
};

// ── GOOGLE REVIEWS API ──
app.get('/reviews', async (req, res) => {
  try {
    const PLACE_ID = 'ChIJYbabucgdDTkRAFAQTaS2fHM';
    const API_KEY = process.env.GOOGLE_API_KEY;

    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${PLACE_ID}&fields=name,rating,reviews&key=${API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK') {
      return res.status(500).json({ success: false, message: data.status });
    }

    res.json({
      success: true,
      reviews: data.result.reviews || [],
      rating: data.result.rating
    });

  } catch (err) {
    console.error('Google Reviews Error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch reviews' });
  }
});

const userRouter = require('./routes/user');
app.use('/user', userRouter);

const intakeRouter = require('./routes/intake');
app.use('/intake', intakeRouter);
// ── ROUTES ──
app.use('/appointments', appointmentsRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

// ── 404 handler ──
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});

// ── Global error handler ──
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (err.message?.startsWith('CORS')) {
    return res.status(403).json({ success: false, message: err.message });
  }
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ── START ──
connectDB().then(() => {
  startScheduler();
  app.listen(PORT, () => {
    console.log(`
🦷 Smirk Dental Backend running
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 Server : http://localhost:${PORT}
📋 Health : http://localhost:${PORT}/health
📅 Appts  : http://localhost:${PORT}/appointments
🌍 Env    : ${process.env.NODE_ENV || 'development'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
