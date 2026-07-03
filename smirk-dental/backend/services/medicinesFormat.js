/**
 * Admin prescription medicines: [{ name, schedule }]
 * Stored as JSON in medicinesText; legacy plain-text lines supported on read.
 */

function normalizeMedicineItem(item) {
  if (!item || typeof item !== 'object') return null;
  const name = String(item.name || '').trim().slice(0, 200);
  const schedule = String(item.schedule || '').trim().slice(0, 300);
  if (!name) return null;
  return { name, schedule };
}

function normalizeMedicinesList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeMedicineItem).filter(Boolean);
}

function serializeMedicines(medicines) {
  return JSON.stringify(normalizeMedicinesList(medicines));
}

function parseMedicinesText(text) {
  if (!text || !String(text).trim()) return [];

  const raw = String(text).trim();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return normalizeMedicinesList(parsed);
  } catch {
    /* legacy plain text */
  }

  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const dash = line.match(/^(.+?)\s*[—–-]\s*(.+)$/);
      if (dash) {
        return { name: dash[1].trim(), schedule: dash[2].trim() };
      }
      return { name: line, schedule: '' };
    });
}

/** Accept array (new API) or string (legacy) from req.body.medicines */
function parseMedicinesBody(raw) {
  if (Array.isArray(raw)) return normalizeMedicinesList(raw);
  if (typeof raw === 'string') return parseMedicinesText(raw);
  return [];
}

module.exports = {
  normalizeMedicinesList,
  serializeMedicines,
  parseMedicinesText,
  parseMedicinesBody,
};
