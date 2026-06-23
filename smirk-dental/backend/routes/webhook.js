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

  console.log('📡 WhatsApp webhook GET', {
    mode: mode || '(none)',
    tokenMatch: token === VERIFY_TOKEN,
    hasVerifyTokenEnv: !!VERIFY_TOKEN,
  });

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    return res.status(200).send(challenge);
  }

  console.warn('❌ Webhook GET rejected (mode/token mismatch)');
  res.sendStatus(403);
});

router.post('/', (req, res) => {
  try {
    const appSecret = (process.env.WHATSAPP_APP_SECRET || '').trim() || undefined;
    const signature = req.get('X-Hub-Signature-256');
    const rawBody = req.rawBody;

    if (!verifyMetaWebhookSignature(appSecret, rawBody, signature)) {
      console.warn('❌ WhatsApp webhook signature verification failed', {
        appSecretConfigured: !!appSecret,
        hasSignatureHeader: !!signature,
        hasRawBody: !!rawBody,
        hint: appSecret
          ? 'Check WHATSAPP_APP_SECRET matches Meta App Secret exactly, or remove it for testing'
          : 'Meta sent a signature but WHATSAPP_APP_SECRET is not set',
      });
      return res.sendStatus(403);
    }

    if (mongoose.connection.readyState !== 1) {
      console.error('❌ Webhook received but MongoDB is not connected');
      return res.sendStatus(503);
    }

    // Meta expects a fast 200 — process bot logic after responding
    res.sendStatus(200);

    const body = req.body || {};
    setImmediate(() => {
      processWebhookBody(body).catch((err) => {
        console.error('❌ Webhook async processing error:', err.message || err);
      });
    });
  } catch (err) {
    console.error('❌ Webhook handler error:', err.message || err);
    if (!res.headersSent) {
      res.sendStatus(500);
    }
  }
});

module.exports = router;
