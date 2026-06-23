const axios = require('axios');

function apiBase() {
  const base = `${process.env.WHATSAPP_API_URL}/${process.env.WHATSAPP_PHONE_ID}/messages`;
  return base;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

function normalizeTo(to) {
  return String(to).replace(/\D/g, '');
}

function botSendContext() {
  const phoneId = process.env.WHATSAPP_PHONE_ID || null;
  return {
    botPhoneId: phoneId,
    botNumber: phoneId ? `phone_id ${phoneId}` : '(not configured)',
  };
}

function logOutbound(kind, to, extra = {}) {
  const bot = botSendContext();
  console.log(`📤 Outbound WA [${kind}]`, {
    botNumber: bot.botNumber,
    botPhoneId: bot.botPhoneId,
    toUser: normalizeTo(to),
    ...extra,
  });
}

async function postMessagePayload(payload) {
  const url = apiBase();
  await axios.post(url, payload, { headers: authHeaders() });
}

/**
 * Plain text message (backward compatible with existing callers).
 */
async function sendText(to, body) {
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_ID) {
    console.warn('WhatsApp not configured: skipping sendText');
    return;
  }
  try {
    await postMessagePayload({
      messaging_product: 'whatsapp',
      to: normalizeTo(to),
      type: 'text',
      text: { body: String(body).slice(0, 4096) },
    });
    logOutbound('text', to, {
      preview: String(body).slice(0, 120).replace(/\s+/g, ' ').trim(),
    });
  } catch (err) {
    console.error('❌ WhatsApp sendText error:', {
      ...botSendContext(),
      toUser: normalizeTo(to),
      error: err.response?.data || err.message,
    });
  }
}

/**
 * Interactive reply buttons (max 3). Titles max 20 chars per Cloud API.
 */
async function sendReplyButtons(to, bodyText, buttons) {
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_ID) {
    console.warn('WhatsApp not configured: skipping sendReplyButtons');
    return;
  }
  const safeButtons = (buttons || []).slice(0, 3).map((b) => ({
    type: 'reply',
    reply: {
      id: String(b.id).slice(0, 256),
      title: String(b.title).slice(0, 20),
    },
  }));
  if (!safeButtons.length) {
    await sendText(to, bodyText);
    return;
  }
  try {
    await postMessagePayload({
      messaging_product: 'whatsapp',
      to: normalizeTo(to),
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: String(bodyText).slice(0, 1024) },
        action: { buttons: safeButtons },
      },
    });
    logOutbound('buttons', to, {
      buttons: safeButtons.map((b) => b.reply.title),
      preview: String(bodyText).slice(0, 80).replace(/\s+/g, ' ').trim(),
    });
  } catch (err) {
    console.error('❌ WhatsApp sendReplyButtons error:', {
      ...botSendContext(),
      toUser: normalizeTo(to),
      error: err.response?.data || err.message,
    });
  }
}

/**
 * Interactive list (max 10 rows total across sections).
 * @param {{ id: string, title: string, description?: string }[]} rows
 */
async function sendListMessage(to, bodyText, buttonLabel, rows, headerText) {
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_ID) {
    console.warn('WhatsApp not configured: skipping sendListMessage');
    return;
  }
  const safeRows = (rows || []).slice(0, 10).map((r) => ({
    id: String(r.id).slice(0, 200),
    title: String(r.title).slice(0, 24),
    ...(r.description ? { description: String(r.description).slice(0, 72) } : {}),
  }));
  if (!safeRows.length) {
    await sendText(to, bodyText);
    return;
  }
  try {
    const interactive = {
      type: 'list',
      body: { text: String(bodyText).slice(0, 1024) },
      action: {
        button: String(buttonLabel || 'Open').slice(0, 20),
        sections: [{ title: 'Options', rows: safeRows }],
      },
    };
    if (headerText) {
      interactive.header = { type: 'text', text: String(headerText).slice(0, 60) };
    }
    await postMessagePayload({
      messaging_product: 'whatsapp',
      to: normalizeTo(to),
      type: 'interactive',
      interactive,
    });
    logOutbound('list', to, {
      listButton: String(buttonLabel || 'Open').slice(0, 20),
      rowCount: safeRows.length,
      preview: String(bodyText).slice(0, 80).replace(/\s+/g, ' ').trim(),
    });
  } catch (err) {
    console.error('❌ WhatsApp sendListMessage error:', {
      ...botSendContext(),
      toUser: normalizeTo(to),
      error: err.response?.data || err.message,
    });
  }
}

/**
 * Send an approved template (required for many outbound-initiated messages).
 * @param {string[]} bodyParams positional {{1}}, {{2}}, ...
 */
async function sendTemplate(to, templateName, languageCode, bodyParams = []) {
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_ID) {
    console.warn('WhatsApp not configured: skipping sendTemplate');
    return;
  }
  if (!templateName) return;
  try {
    const components = [];
    if (bodyParams.length) {
      components.push({
        type: 'body',
        parameters: bodyParams.map((t) => ({ type: 'text', text: String(t).slice(0, 1024) })),
      });
    }
    await postMessagePayload({
      messaging_product: 'whatsapp',
      to: normalizeTo(to),
      type: 'template',
      template: {
        name: String(templateName).slice(0, 512),
        language: { code: languageCode || 'en' },
        ...(components.length ? { components } : {}),
      },
    });
    logOutbound('template', to, { templateName });
  } catch (err) {
    console.error('❌ WhatsApp sendTemplate error:', {
      ...botSendContext(),
      toUser: normalizeTo(to),
      templateName,
      error: err.response?.data || err.message,
    });
  }
}

/** @deprecated use sendText — kept for routes that still use the old name */
const sendWhatsAppMessage = sendText;

module.exports = {
  sendText,
  sendReplyButtons,
  sendListMessage,
  sendTemplate,
  sendWhatsAppMessage,
  normalizeTo,
};
