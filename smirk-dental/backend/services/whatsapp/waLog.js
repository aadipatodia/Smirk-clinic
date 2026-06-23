let cachedBotDisplay =
  (process.env.WHATSAPP_DISPLAY_NUMBER && String(process.env.WHATSAPP_DISPLAY_NUMBER).trim()) ||
  null;

function formatPhone(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  return digits ? `+${digits}` : String(raw);
}

function rememberBotNumber(metadata) {
  const raw = metadata?.display_phone_number;
  if (raw != null && String(raw).trim()) {
    cachedBotDisplay = formatPhone(raw);
  }
}

function botLabel() {
  if (cachedBotDisplay) return cachedBotDisplay;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  return phoneId ? `phone_id ${phoneId}` : 'bot';
}

function logUserMessage(waId, message, role = 'patient') {
  const tag = role === 'doctor' ? 'doc' : 'user';
  console.log(`${tag} (${formatPhone(waId)}): ${message}`);
}

function logBotReply(reply) {
  const text = String(reply).replace(/\s+/g, ' ').trim();
  console.log(`bot (${botLabel()}): ${text}`);
}

module.exports = {
  formatPhone,
  rememberBotNumber,
  logUserMessage,
  logBotReply,
};
