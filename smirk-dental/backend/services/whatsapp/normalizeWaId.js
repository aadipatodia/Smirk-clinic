function normalizeWaId(waId) {
  if (!waId) return '';
  return String(waId).replace(/\D/g, '');
}

module.exports = { normalizeWaId };
