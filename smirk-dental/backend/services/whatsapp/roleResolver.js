const { normalizeWaId } = require('./normalizeWaId');

/**
 * Single clinic doctor: match env DOCTOR_WA_ID (digits, country code, no +).
 * Everyone else is treated as patient for WhatsApp UX.
 */
async function resolveRole(waId) {
  const normalized = normalizeWaId(waId);
  const doctorEnv = normalizeWaId(process.env.DOCTOR_WA_ID || '');
  if (doctorEnv && normalized === doctorEnv) {
    return 'doctor';
  }
  return 'patient';
}

module.exports = { resolveRole };
