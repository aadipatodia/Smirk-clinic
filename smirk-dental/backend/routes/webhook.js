const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { verifyMetaWebhookSignature } = require('../services/whatsapp/verifySignature');
const { processWebhookBody } = require('../services/whatsapp/flowEngine');

router.get('/', (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

router.post('/', async (req, res) => {
  try {
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    const signature = req.get('X-Hub-Signature-256');
    const rawBody = req.rawBody;

    if (!verifyMetaWebhookSignature(appSecret, rawBody, signature)) {
      console.warn('❌ WhatsApp webhook signature verification failed');
      return res.sendStatus(403);
    }

    if (mongoose.connection.readyState !== 1) {
      console.error('Webhook received but MongoDB is not connected');
      return res.sendStatus(503);
    }

    await processWebhookBody(req.body || {});
    return res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    return res.sendStatus(500);
  }
});

module.exports = router;
