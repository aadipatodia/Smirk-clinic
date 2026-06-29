const axios = require('axios');
const { todayYmdIst } = require('./whatsapp/dateIst');

const GEMINI_URL =
  'https://generativeai.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

/**
 * Parse doctor input (text and/or prescription image) and detect what visit fields
 * are present vs missing. Dates in any format are normalized to YYYY-MM-DD.
 *
 * @param {{ doctorText?: string, imageBase64?: string, mimeType?: string, mode?: 'prescription'|'procedure_only', hasPrescriptionFile?: boolean, alreadyHave?: { procedure?: string|null, date?: string|null } }}
 * @returns {Promise<{ procedure: string|null, date: string|null, procedurePresent: boolean, datePresent: boolean, missing: string[], confidence: number }>}
 */
async function parseVisitInput({
  doctorText,
  imageBase64,
  mimeType,
  mode = 'procedure_only',
  hasPrescriptionFile = false,
  alreadyHave = {},
}) {
  const fallback = parseTextFallback(doctorText, { hasPrescriptionFile, mode });

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return buildVisitParseResult(fallback, { mode, hasPrescriptionFile });
  }

  const today = todayYmdIst() || new Date().toISOString().slice(0, 10);

  const contextLines = [];
  if (alreadyHave.procedure) contextLines.push(`- procedure already recorded: ${alreadyHave.procedure}`);
  if (alreadyHave.date) contextLines.push(`- date already recorded: ${alreadyHave.date}`);
  if (hasPrescriptionFile) contextLines.push('- prescription file already attached');

  const parts = [
    {
      text: [
        'You are a dental clinic assistant parsing a doctor\'s visit record input.',
        `Today (IST) is ${today}.`,
        contextLines.length ? `\nAlready collected:\n${contextLines.join('\n')}` : '',
        '',
        'Extract ONLY what is explicitly stated or clearly readable in THIS message — do not guess.',
        'If a field is already collected, only update it if the doctor clearly provides a new value.',
        '',
        'Fields:',
        '1. procedure — dental procedure done (short phrase). null if not mentioned in this message.',
        '2. date — visit date normalized to YYYY-MM-DD. Accept ANY format: 24/6/26, 24-06-2026, 24 June 2026, Jun 24 2026, yesterday, today, etc. null if not mentioned.',
        '',
        'Respond with JSON only, no markdown:',
        '{',
        '  "procedure": "..." or null,',
        '  "date": "YYYY-MM-DD" or null,',
        '  "procedurePresent": true/false,',
        '  "datePresent": true/false,',
        '  "confidence": 0.0',
        '}',
        '',
        'Set procedurePresent/datePresent true ONLY when that field is clearly provided in this message.',
      ].join('\n'),
    },
  ];

  if (doctorText?.trim()) {
    parts.push({ text: `Doctor message:\n${doctorText.trim()}` });
  }

  if (imageBase64 && mimeType) {
    parts.push({
      inline_data: { mime_type: mimeType, data: imageBase64 },
    });
    parts.push({
      text: 'The image may be a prescription — also read procedure and date from it if visible.',
    });
  }

  try {
    const res = await axios.post(
      `${GEMINI_URL}?key=${apiKey}`,
      {
        contents: [{ parts }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 384 },
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
    );

    const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = parseJsonFromText(text);
    if (!parsed) return buildVisitParseResult(fallback, { mode, hasPrescriptionFile });

    const merged = {
      procedure: parsed.procedurePresent ? sanitizeProcedure(parsed.procedure) : null,
      date: parsed.datePresent ? sanitizeDate(parsed.date) : null,
      procedurePresent: !!parsed.procedurePresent && !!sanitizeProcedure(parsed.procedure),
      datePresent: !!parsed.datePresent && !!sanitizeDate(parsed.date),
      confidence: clampConfidence(parsed.confidence),
    };

    return buildVisitParseResult(merged, { mode, hasPrescriptionFile });
  } catch (err) {
    console.error('Gemini parseVisitInput failed:', err.response?.data || err.message);
    return buildVisitParseResult(fallback, { mode, hasPrescriptionFile });
  }
}

function buildVisitParseResult(extracted, { mode, hasPrescriptionFile }) {
  const missing = [];
  if (!extracted.procedurePresent || !extracted.procedure) missing.push('procedure');
  if (!extracted.datePresent || !extracted.date) missing.push('date');
  if (mode === 'prescription' && !hasPrescriptionFile) missing.push('prescription');

  return {
    procedure: extracted.procedurePresent ? extracted.procedure : null,
    date: extracted.datePresent ? extracted.date : null,
    procedurePresent: !!extracted.procedurePresent && !!extracted.procedure,
    datePresent: !!extracted.datePresent && !!extracted.date,
    missing,
    confidence: extracted.confidence ?? 0.5,
  };
}

function parseJsonFromText(text) {
  const raw = String(text || '').trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function sanitizeProcedure(value) {
  const s = String(value || '').trim().slice(0, 500);
  return s.length >= 2 ? s : null;
}

function sanitizeDate(value) {
  const s = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return normalizeDateLoose(s);
}

/** Best-effort date normalization without Gemini. */
function normalizeDateLoose(text) {
  const s = String(text || '').trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const iso = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;

  const dmy = s.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (dmy) {
    let [, d, m, y] = dmy;
    if (y.length === 2) y = `20${y}`;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const months =
    'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december';
  const named = new RegExp(
    `(\\d{1,2})\\s+(${months})\\s+(\\d{4})|(${months})\\s+(\\d{1,2}),?\\s+(\\d{4})`,
    'i'
  );
  const nm = s.match(named);
  if (nm) {
    const monthMap = {
      jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
      may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
      sep: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
    };
    if (nm[1]) {
      const mo = monthMap[nm[2].slice(0, 3).toLowerCase()] || monthMap[nm[2].toLowerCase()];
      if (mo) return `${nm[3]}-${String(mo).padStart(2, '0')}-${nm[1].padStart(2, '0')}`;
    } else if (nm[4]) {
      const mo = monthMap[nm[4].slice(0, 3).toLowerCase()] || monthMap[nm[4].toLowerCase()];
      if (mo) return `${nm[6]}-${String(mo).padStart(2, '0')}-${nm[5].padStart(2, '0')}`;
    }
  }

  if (/^today$/i.test(s)) return todayYmdIst();
  if (/^yesterday$/i.test(s)) {
    const t = todayYmdIst();
    if (!t) return null;
    const [y, m, d] = t.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d - 1));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  }

  return null;
}

function clampConfidence(n) {
  const v = Number(n);
  if (Number.isNaN(v)) return 0.5;
  return Math.min(1, Math.max(0, v));
}

function parseTextFallback(doctorText, { hasPrescriptionFile, mode }) {
  const text = String(doctorText || '').trim();
  const result = {
    procedure: null,
    date: null,
    procedurePresent: false,
    datePresent: false,
    confidence: 0.35,
  };

  if (!text) return result;

  const dateCandidates = [
    text.match(/\b(\d{4}-\d{2}-\d{2})\b/),
    text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/),
  ];

  let normalizedDate = null;
  for (const m of dateCandidates) {
    if (m) {
      normalizedDate = normalizeDateLoose(m[0]);
      if (normalizedDate) break;
    }
  }
  if (!normalizedDate) normalizedDate = normalizeDateLoose(text);

  if (normalizedDate) {
    result.date = normalizedDate;
    result.datePresent = true;
  }

  let procText = text;
  if (normalizedDate) {
    procText = procText
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')
      .replace(/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/g, '')
      .replace(/\b\d{1,2}\s+\w+\s+\d{4}\b/gi, '')
      .trim();
  }
  procText = procText.replace(/^[,.\-–—:\s]+|[,.\-–—:\s]+$/g, '').trim();
  procText = procText.replace(/\s+(done\s+)?on\s*$/i, '').trim();

  if (procText.length >= 2) {
    result.procedure = procText.slice(0, 500);
    result.procedurePresent = true;
  }

  return result;
}

/** @deprecated use parseVisitInput */
async function extractPrescriptionInfo(opts) {
  const r = await parseVisitInput({
    doctorText: opts.caption,
    imageBase64: opts.imageBase64,
    mimeType: opts.mimeType,
    mode: 'prescription',
    hasPrescriptionFile: !!opts.imageBase64,
  });
  return {
    procedure: r.procedure || 'General check-up',
    date: r.date || todayYmdIst(),
    confidence: r.confidence,
  };
}

module.exports = { parseVisitInput, extractPrescriptionInfo, normalizeDateLoose };
