const axios = require('axios');
const { todayYmdIst } = require('./whatsapp/dateIst');

const GEMINI_URL =
  'https://generativeai.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

/**
 * Use Gemini to extract procedure name and visit date from doctor caption and/or prescription image.
 * @returns {{ procedure: string, date: string, confidence: number }}
 */
async function extractPrescriptionInfo({ caption, imageBase64, mimeType }) {
  const fallback = parseCaptionFallback(caption);

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return fallback;
  }

  const parts = [
    {
      text: [
        'You are a dental clinic assistant. Extract from the doctor input and/or prescription image:',
        '1. procedure — what dental procedure was done (short phrase, e.g. "Root canal", "Scaling", "Filling")',
        '2. date — visit date in YYYY-MM-DD (IST). Use today if unclear.',
        '',
        'Respond with JSON only, no markdown:',
        '{"procedure":"...","date":"YYYY-MM-DD","confidence":0.0}',
        'confidence is 0-1 for how sure you are.',
      ].join('\n'),
    },
  ];

  if (caption?.trim()) {
    parts.push({ text: `Doctor message/caption:\n${caption.trim()}` });
  }

  if (imageBase64 && mimeType) {
    parts.push({
      inline_data: {
        mime_type: mimeType,
        data: imageBase64,
      },
    });
  }

  try {
    const res = await axios.post(
      `${GEMINI_URL}?key=${apiKey}`,
      {
        contents: [{ parts }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
    );

    const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = parseJsonFromText(text);
    if (!parsed) return fallback;

    return {
      procedure: sanitizeProcedure(parsed.procedure) || fallback.procedure,
      date: sanitizeDate(parsed.date) || fallback.date,
      confidence: clampConfidence(parsed.confidence),
    };
  } catch (err) {
    console.error('Gemini extract failed:', err.response?.data || err.message);
    return fallback;
  }
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
  return s || null;
}

function sanitizeDate(value) {
  const s = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function clampConfidence(n) {
  const v = Number(n);
  if (Number.isNaN(v)) return 0.5;
  return Math.min(1, Math.max(0, v));
}

/** Simple fallback when Gemini is unavailable — parse caption or use defaults. */
function parseCaptionFallback(caption) {
  const today = todayYmdIst() || new Date().toISOString().slice(0, 10);
  const text = String(caption || '').trim();

  let date = today;
  const dateMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (dateMatch) date = dateMatch[1];

  const dmyMatch = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  let procedure = 'General check-up';
  if (text.length > 3) {
    const withoutDate = text.replace(/\d{4}-\d{2}-\d{2}/g, '').replace(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/g, '').trim();
    if (withoutDate.length > 2) procedure = withoutDate.slice(0, 500);
  }

  return { procedure, date, confidence: 0.3 };
}

module.exports = { extractPrescriptionInfo };
