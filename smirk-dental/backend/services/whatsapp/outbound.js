const axios = require('axios');
const { logBotReply } = require('./waLog');

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

async function postMessagePayload(payload) {
  const url = apiBase();
  await axios.post(url, payload, { headers: authHeaders() });
}

async function postMessagePayloadStrict(payload) {
  try {
    await postMessagePayload(payload);
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.response?.data || err.message;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
}

/**
 * Plain text message (backward compatible with existing callers).
 */
async function sendText(to, body, { strict = false } = {}) {
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_ID) {
    const msg = 'WhatsApp not configured';
    if (strict) throw new Error(msg);
    console.warn(`WhatsApp not configured: skipping sendText`);
    return;
  }
  const payload = {
    messaging_product: 'whatsapp',
    to: normalizeTo(to),
    type: 'text',
    text: { body: String(body).slice(0, 4096) },
  };
  try {
    if (strict) {
      await postMessagePayloadStrict(payload);
    } else {
      await postMessagePayload(payload);
    }
    logBotReply(body);
  } catch (err) {
    console.error('❌ WhatsApp sendText error:', {
      ...botSendContext(),
      toUser: normalizeTo(to),
      error: err.response?.data || err.message,
    });
    if (strict) throw err;
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
    const buttonLabels = safeButtons.map((b) => b.reply.title).join(' | ');
    logBotReply(buttonLabels ? `${bodyText} [${buttonLabels}]` : bodyText);
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
    logBotReply(bodyText);
  } catch (err) {
    console.error('❌ WhatsApp sendListMessage error:', {
      ...botSendContext(),
      toUser: normalizeTo(to),
      error: err.response?.data || err.message,
    });
  }
}

/**
 * Interactive CTA button that opens a URL (e.g. Google review page).
 */
async function sendCtaUrl(to, bodyText, displayText, url) {
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_ID) {
    console.warn('WhatsApp not configured: skipping sendCtaUrl');
    return;
  }
  const safeUrl = String(url || '').trim();
  if (!safeUrl) {
    await sendText(to, bodyText);
    return;
  }
  try {
    await postMessagePayload({
      messaging_product: 'whatsapp',
      to: normalizeTo(to),
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        body: { text: String(bodyText).slice(0, 1024) },
        action: {
          name: 'cta_url',
          parameters: {
            display_text: String(displayText || 'Open link').slice(0, 20),
            url: safeUrl,
          },
        },
      },
    });
    logBotReply(`${bodyText} [${displayText} → ${safeUrl}]`);
  } catch (err) {
    console.error('❌ WhatsApp sendCtaUrl error:', {
      ...botSendContext(),
      toUser: normalizeTo(to),
      error: err.response?.data || err.message,
    });
  }
}

/**
 * Send an approved template (required for outbound messages outside the 24-hour window).
 * @param {string[]} bodyParams positional {{1}}, {{2}}, ...
 * @param {{ strict?: boolean, headerText?: string, headerMedia?: { kind: 'image'|'document', mediaId: string, filename?: string }, urlButton?: { index?: number, url: string } }} [options]
 */
async function sendTemplate(to, templateName, languageCode, bodyParams = [], options = {}) {
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_ID) {
    const msg = 'WhatsApp not configured';
    if (options.strict) throw new Error(msg);
    console.warn('WhatsApp not configured: skipping sendTemplate');
    return;
  }
  if (!templateName) {
    if (options.strict) throw new Error('WhatsApp template name not configured');
    return;
  }

  const components = [];
  if (options.headerText != null && options.headerText !== '') {
    components.push({
      type: 'header',
      parameters: [{ type: 'text', text: String(options.headerText).slice(0, 60) }],
    });
  }
  const header = options.headerMedia;
  if (header?.mediaId) {
    const param =
      header.kind === 'document'
        ? {
            type: 'document',
            document: {
              id: String(header.mediaId),
              filename: String(header.filename || 'prescription.pdf').slice(0, 256),
            },
          }
        : { type: 'image', image: { id: String(header.mediaId) } };
    components.push({ type: 'header', parameters: [param] });
  }
  if (bodyParams.length) {
    components.push({
      type: 'body',
      parameters: bodyParams.map((t) => ({ type: 'text', text: String(t).slice(0, 1024) })),
    });
  }
  if (options.urlButton?.url) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: String(options.urlButton.index ?? 0),
      parameters: [{ type: 'text', text: String(options.urlButton.url).slice(0, 2000) }],
    });
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: normalizeTo(to),
    type: 'template',
    template: {
      name: String(templateName).slice(0, 512),
      language: { code: languageCode || 'en' },
      ...(components.length ? { components } : {}),
    },
  };

  try {
    if (options.strict) {
      await postMessagePayloadStrict(payload);
    } else {
      await postMessagePayload(payload);
    }
    logBotReply(`[template: ${templateName}]`);
  } catch (err) {
    console.error('❌ WhatsApp sendTemplate error:', {
      ...botSendContext(),
      toUser: normalizeTo(to),
      templateName,
      error: err.response?.data || err.message,
    });
    if (options.strict) throw err;
  }
}

/** True when Meta rejects a free-form message because the 24-hour window closed. */
function isServiceWindowError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  const code = err?.response?.data?.error?.code;
  return (
    code === 131047 ||
    code === 131026 ||
    msg.includes('re-engagement') ||
    msg.includes('24 hour') ||
    msg.includes('24-hour') ||
    msg.includes('outside the allowed window') ||
    msg.includes('message undeliverable')
  );
}

/** @deprecated use sendText — kept for routes that still use the old name */
const sendWhatsAppMessage = sendText;

async function sendImageByMediaId(to, mediaId, caption) {
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_ID) {
    throw new Error('WhatsApp not configured');
  }
  const payload = {
    messaging_product: 'whatsapp',
    to: normalizeTo(to),
    type: 'image',
    image: { id: mediaId },
  };
  if (caption) payload.image.caption = String(caption).slice(0, 1024);
  try {
    await postMessagePayloadStrict(payload);
    logBotReply(caption ? `[image] ${caption}` : '[image]');
  } catch (err) {
    console.error('❌ WhatsApp sendImageByMediaId error:', {
      ...botSendContext(),
      toUser: normalizeTo(to),
      error: err.message,
    });
    throw err;
  }
}

async function sendDocumentByMediaId(to, mediaId, filename, caption) {
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_ID) {
    throw new Error('WhatsApp not configured');
  }
  const payload = {
    messaging_product: 'whatsapp',
    to: normalizeTo(to),
    type: 'document',
    document: {
      id: mediaId,
      ...(filename ? { filename: String(filename).slice(0, 256) } : {}),
    },
  };
  if (caption) payload.document.caption = String(caption).slice(0, 1024);
  try {
    await postMessagePayloadStrict(payload);
    logBotReply(caption ? `[document] ${caption}` : '[document]');
  } catch (err) {
    console.error('❌ WhatsApp sendDocumentByMediaId error:', {
      ...botSendContext(),
      toUser: normalizeTo(to),
      error: err.message,
    });
    throw err;
  }
}

module.exports = {
  sendText,
  sendReplyButtons,
  sendListMessage,
  sendCtaUrl,
  sendTemplate,
  sendWhatsAppMessage,
  sendImageByMediaId,
  sendDocumentByMediaId,
  normalizeTo,
  isServiceWindowError,
};
