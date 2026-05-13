const crypto = require('crypto');

/**
 * Validates Meta X-Hub-Signature-256 when WHATSAPP_APP_SECRET is set.
 * @param {string|undefined} appSecret
 * @param {Buffer|string|undefined} rawBody
 * @param {string|undefined} signatureHeader e.g. sha256=abcdef...
 */
function verifyMetaWebhookSignature(appSecret, rawBody, signatureHeader) {
  if (!appSecret) return true;
  if (!rawBody || !signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const expected = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');
  const received = signatureHeader.slice('sha256='.length);
  if (expected.length !== received.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(received, 'utf8'));
  } catch {
    return false;
  }
}

module.exports = { verifyMetaWebhookSignature };
