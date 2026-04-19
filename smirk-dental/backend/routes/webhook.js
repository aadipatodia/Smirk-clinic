const express = require('express');
const router = express.Router();

const { sendWhatsAppMessage } = require('../services/whatsapp');

// Doctor number (hardcoded)
const DOCTOR_NUMBER = "917428134319";

// VERIFY WEBHOOK
router.get('/', (req, res) => {
    const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log("✅ Webhook verified");
        return res.status(200).send(challenge);
    }

    res.sendStatus(403);
});

// RECEIVE MESSAGES
router.post('/', async (req, res) => {
    try {
        const entry = req.body.entry?.[0];
        const changes = entry?.changes?.[0];
        const message = changes?.value?.messages?.[0];

        if (!message) return res.sendStatus(200);

        const from = message.from;
        const text = message.text?.body?.toLowerCase() || "";

        console.log("📩 Incoming:", from, text);

        const isDoctor = from === DOCTOR_NUMBER;

        // ===== BASIC LOGIC =====
        if (text.includes("hi")) {
            await sendWhatsAppMessage(from,
                isDoctor
                    ? "👩‍⚕️ Welcome Doctor\n1. View today's appointments\n2. Block slot"
                    : "🦷 Welcome to Smirk Dental\n1. Book appointment\n2. View prescription\n3. Location"
            );
        }

        if (text.includes("location")) {
            await sendWhatsAppMessage(from,
                "📍 Smirk Dental Location:\nhttps://maps.google.com/?q=Smirk+Dental"
            );
        }

        res.sendStatus(200);

    } catch (err) {
        console.error("Webhook error:", err);
        res.sendStatus(500);
    }
});

module.exports = router;