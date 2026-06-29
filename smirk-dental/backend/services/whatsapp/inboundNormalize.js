/**
 * Normalize a single Cloud API `messages[]` item to an internal event.
 * @returns {{ kind: 'button', buttonId: string, title?: string }
 *   | { kind: 'list', rowId: string, title?: string }
 *   | { kind: 'text', body: string }
 *   | { kind: 'unsupported', messageType?: string }}
 */
function normalizeInboundMessage(message) {
  if (!message || typeof message !== 'object') {
    return { kind: 'unsupported' };
  }

  if (message.type === 'interactive' && message.interactive) {
    const inter = message.interactive;
    if (inter.type === 'button_reply' && inter.button_reply?.id) {
      return {
        kind: 'button',
        buttonId: String(inter.button_reply.id),
        title: inter.button_reply.title,
      };
    }
    if (inter.type === 'list_reply' && inter.list_reply?.id) {
      return {
        kind: 'list',
        rowId: String(inter.list_reply.id),
        title: inter.list_reply.title,
      };
    }
  }

  if (message.type === 'text' && message.text?.body != null) {
    return { kind: 'text', body: String(message.text.body).trim() };
  }

  if (message.type === 'image' && message.image?.id) {
    return {
      kind: 'image',
      mediaId: String(message.image.id),
      mimeType: message.image.mime_type || 'image/jpeg',
      caption: message.image.caption ? String(message.image.caption).trim() : '',
    };
  }

  if (message.type === 'document' && message.document?.id) {
    return {
      kind: 'document',
      mediaId: String(message.document.id),
      mimeType: message.document.mime_type || 'application/pdf',
      filename: message.document.filename ? String(message.document.filename) : 'prescription.pdf',
      caption: message.document.caption ? String(message.document.caption).trim() : '',
    };
  }

  return { kind: 'unsupported', messageType: message.type };
}

function collectInboundMessages(body) {
  const out = [];
  const entries = body?.entry || [];
  for (const ent of entries) {
    for (const change of ent.changes || []) {
      const value = change.value;
      if (!value) continue;
      for (const st of value.statuses || []) {
        out.push({ type: 'status', status: st });
      }
      for (const msg of value.messages || []) {
        out.push({ type: 'message', message: msg, metadata: value.metadata });
      }
    }
  }
  return out;
}

/** Human-readable summary of what the user sent (for logs). */
function describeInboundEvent(event) {
  if (!event || !event.kind) return '(unknown)';
  switch (event.kind) {
    case 'text':
      return event.body || '(empty text)';
    case 'button':
      return event.title
        ? `[button] ${event.title} (${event.buttonId})`
        : `[button] ${event.buttonId}`;
    case 'list':
      return event.title
        ? `[list] ${event.title} (${event.rowId})`
        : `[list] ${event.rowId}`;
    case 'image':
      return event.caption ? `[image] ${event.caption}` : '[image]';
    case 'document':
      return event.caption ? `[document] ${event.caption}` : `[document] ${event.filename || ''}`;
    default:
      return event.messageType ? `[${event.messageType}]` : '(unsupported)';
  }
}

/** Clinic / bot number from webhook metadata + env fallback. */
function describeBotNumber(metadata) {
  const rawDisplay = metadata?.display_phone_number;
  const phoneId = metadata?.phone_number_id || process.env.WHATSAPP_PHONE_ID || null;
  const display =
    rawDisplay != null && String(rawDisplay).trim()
      ? `+${String(rawDisplay).replace(/\D/g, '')}`
      : null;
  if (display && phoneId) return { display, phoneId, label: `${display} (phone_id ${phoneId})` };
  if (display) return { display, phoneId, label: display };
  if (phoneId) return { display: null, phoneId, label: `phone_id ${phoneId}` };
  return { display: null, phoneId: null, label: '(bot number not configured)' };
}

module.exports = {
  normalizeInboundMessage,
  collectInboundMessages,
  describeInboundEvent,
  describeBotNumber,
};
