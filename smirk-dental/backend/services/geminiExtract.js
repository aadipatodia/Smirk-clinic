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
  const fallback = parseTextFallback(doctorText);

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
        '2. date — visit date normalized to YYYY-MM-DD. Accept ANY format including without year: "29 june", "24/6/26", "24 June 2026", "yesterday", "today". If year is omitted, assume current year (or previous year if that would be far in the future). null if not mentioned.',
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

    const geminiResult = {
      procedure: parsed.procedurePresent ? sanitizeProcedure(parsed.procedure) : null,
      date: parsed.datePresent ? sanitizeDate(parsed.date) : null,
      procedurePresent: !!parsed.procedurePresent && !!sanitizeProcedure(parsed.procedure),
      datePresent: !!parsed.datePresent && !!sanitizeDate(parsed.date),
      confidence: clampConfidence(parsed.confidence),
    };

    const merged = mergeExtractionResults(geminiResult, fallback);
    return buildVisitParseResult(merged, { mode, hasPrescriptionFile });
  } catch (err) {
    console.error('Gemini parseVisitInput failed:', err.response?.data || err.message);
    return buildVisitParseResult(fallback, { mode, hasPrescriptionFile });
  }
}

function mergeExtractionResults(primary, secondary) {
  const procedure =
    primary.procedurePresent && primary.procedure
      ? primary.procedure
      : secondary.procedurePresent && secondary.procedure
        ? secondary.procedure
        : null;
  const date =
    primary.datePresent && primary.date
      ? primary.date
      : secondary.datePresent && secondary.date
        ? secondary.date
        : null;

  return {
    procedure,
    date,
    procedurePresent: !!procedure,
    datePresent: !!date,
    confidence: Math.max(primary.confidence ?? 0, secondary.confidence ?? 0),
  };
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

function monthNameToNumber(name) {
  const monthMap = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
    sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
    dec: 12, december: 12,
  };
  const key = String(name || '').trim().toLowerCase();
  return monthMap[key] || monthMap[key.slice(0, 3)] || null;
}

/** If year omitted, infer from IST today (recent visit — not far in the future). */
function inferYear(month, day) {
  const today = todayYmdIst();
  if (!today) return new Date().getFullYear();
  const [y, tm, td] = today.split('-').map(Number);
  let year = y;
  const candidate = Date.UTC(y, month - 1, day);
  const todayMs = Date.UTC(y, tm - 1, td);
  if (candidate > todayMs + 7 * 86400000) year = y - 1;
  return year;
}

function ymdFromParts(day, month, year) {
  if (!month || day < 1 || day > 31) return null;
  const y = year || inferYear(month, day);
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Find the first date-like substring in free text; returns { date, matchedText }. */
function findDateInText(text) {
  const s = String(text || '').trim();
  if (!s) return null;

  const months =
    'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec';

  const patterns = [
    {
      type: 'day_month',
      re: new RegExp(`\\b(\\d{1,2})\\s+(${months})(?:\\s+(\\d{4}))?\\b`, 'i'),
    },
    {
      type: 'month_day',
      re: new RegExp(`\\b(${months})\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?\\b`, 'i'),
    },
    { type: 'iso', re: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/ },
    { type: 'dmy', re: /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/ },
  ];

  for (const { type, re } of patterns) {
    const m = s.match(re);
    if (!m) continue;

    let date = null;
    if (type === 'day_month') {
      const mo = monthNameToNumber(m[2]);
      date = ymdFromParts(parseInt(m[1], 10), mo, m[3] ? parseInt(m[3], 10) : null);
    } else if (type === 'month_day') {
      const mo = monthNameToNumber(m[1]);
      date = ymdFromParts(parseInt(m[2], 10), mo, m[3] ? parseInt(m[3], 10) : null);
    } else if (type === 'iso') {
      date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    } else if (type === 'dmy') {
      let [, d, mo, y] = m;
      if (y.length === 2) y = `20${y}`;
      date = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }

    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { date, matchedText: m[0] };
    }
  }

  if (/^today$/i.test(s)) return { date: todayYmdIst(), matchedText: s };
  if (/^yesterday$/i.test(s)) {
    const t = todayYmdIst();
    if (!t) return null;
    const [y, m, d] = t.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d - 1));
    return {
      date: `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`,
      matchedText: s,
    };
  }

  return null;
}

/** Best-effort date normalization without Gemini. */
function normalizeDateLoose(text) {
  const found = findDateInText(text);
  return found?.date || null;
}

function clampConfidence(n) {
  const v = Number(n);
  if (Number.isNaN(v)) return 0.5;
  return Math.min(1, Math.max(0, v));
}

function cleanProcedureText(text, dateMatchedText) {
  let procText = String(text || '').trim();
  if (dateMatchedText) {
    procText = procText.replace(dateMatchedText, ' ');
  }
  procText = procText
    .replace(/\b(done|completed|performed|did)\b/gi, ' ')
    .replace(/\bon\s*$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^[,.\-–—:\s]+|[,.\-–—:\s]+$/g, '')
    .trim();
  return procText;
}

function parseTextFallback(doctorText) {
  const text = String(doctorText || '').trim();
  const result = {
    procedure: null,
    date: null,
    procedurePresent: false,
    datePresent: false,
    confidence: 0.35,
  };

  if (!text) return result;

  const found = findDateInText(text);
  if (found?.date) {
    result.date = found.date;
    result.datePresent = true;
  }

  const procText = cleanProcedureText(text, found?.matchedText);
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

module.exports = { parseVisitInput, extractPrescriptionInfo, normalizeDateLoose, findDateInText };
