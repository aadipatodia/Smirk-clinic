const fs = require('fs');
const path = require('path');
const axios = require('axios');

const UPLOAD_DIR = path.join(__dirname, '../../uploads/prescriptions');

function authHeaders() {
  return { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` };
}

function graphBase() {
  return (process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v19.0').replace(/\/$/, '');
}

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

/**
 * Download WhatsApp media by id and save to disk.
 * @returns {{ storagePath: string, mimeType: string, filename: string, buffer: Buffer }}
 */
async function downloadAndStoreMedia(mediaId, { prefix = 'rx' } = {}) {
  if (!process.env.WHATSAPP_TOKEN) {
    throw new Error('WhatsApp not configured');
  }
  ensureUploadDir();

  const metaRes = await axios.get(`${graphBase()}/${mediaId}`, { headers: authHeaders() });
  const mediaUrl = metaRes.data?.url;
  const mimeType = metaRes.data?.mime_type || 'application/octet-stream';
  if (!mediaUrl) throw new Error('Could not resolve media URL');

  const fileRes = await axios.get(mediaUrl, {
    headers: authHeaders(),
    responseType: 'arraybuffer',
  });
  const buffer = Buffer.from(fileRes.data);

  const ext = extensionFromMime(mimeType);
  const filename = `${prefix}_${Date.now()}${ext}`;
  const storagePath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(storagePath, buffer);

  return { storagePath, mimeType, filename, buffer };
}

function extensionFromMime(mime) {
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
  };
  return map[mime] || '.bin';
}

/**
 * Upload a local file to WhatsApp and return media id for outbound send.
 */
async function uploadMediaFromFile(filePath, mimeType) {
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_ID) {
    throw new Error('WhatsApp not configured');
  }

  const buffer = fs.readFileSync(filePath);
  const blob = new Blob([buffer], { type: mimeType || 'application/octet-stream' });
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', blob, path.basename(filePath));

  const url = `${graphBase()}/${process.env.WHATSAPP_PHONE_ID}/media`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Media upload failed: ${errText}`);
  }

  const data = await res.json();
  const id = data?.id;
  if (!id) throw new Error('Media upload failed');
  return id;
}

module.exports = {
  downloadAndStoreMedia,
  uploadMediaFromFile,
  UPLOAD_DIR,
};
