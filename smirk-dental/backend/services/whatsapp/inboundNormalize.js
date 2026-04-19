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

module.exports = { normalizeInboundMessage, collectInboundMessages };
