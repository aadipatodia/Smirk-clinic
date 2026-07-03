const PatientProfile = require('../models/PatientProfile');
const PatientVisitRecord = require('../models/PatientVisitRecord');
const Appointment = require('../models/Appointment');
const { phoneDigits } = require('./appointmentService');
const { sendText, sendTemplate, isServiceWindowError } = require('./whatsapp/outbound');
const { uploadMediaFromFile } = require('./whatsapp/media');
const { serializeMedicines, parseMedicinesText } = require('./medicinesFormat');
const fs = require('fs');
const path = require('path');

function normalizeStoredPhone(phone) {
  const d = phoneDigits(phone);
  if (!d || d.length < 10) return null;
  if (d.length === 10 && /^[6-9]/.test(d)) return `91${d}`;
  if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`;
  return d;
}

/** WhatsApp `to` — digits only, with country code (India 10-digit → 91…). */
function patientWaTo(phone) {
  return normalizeStoredPhone(phone);
}

function rxMediaType(rx) {
  if (!rx) return null;
  return rx.mediaType || rx.type || null;
}

async function resolveRxMediaId(rx) {
  if (rx.storagePath && fs.existsSync(rx.storagePath)) {
    try {
      return await uploadMediaFromFile(rx.storagePath, rx.mimeType || 'application/octet-stream');
    } catch (uploadErr) {
      console.error('Prescription re-upload failed, trying stored waMediaId:', uploadErr.message || uploadErr);
      if (rx.waMediaId) return rx.waMediaId;
      throw uploadErr;
    }
  }
  if (rx.waMediaId) return rx.waMediaId;
  throw new Error('Prescription file not available to send');
}

async function deliverPrescriptionMedia(toWa, rx, caption) {
  const { sendImageByMediaId, sendDocumentByMediaId } = require('./whatsapp/outbound');
  const isDoc = rxMediaType(rx) === 'document';
  const mediaId = await resolveRxMediaId(rx);

  if (isDoc) {
    await sendDocumentByMediaId(toWa, mediaId, rx.filename || 'prescription.pdf', caption);
  } else {
    await sendImageByMediaId(toWa, mediaId, caption);
  }
}

function templateLang() {
  return process.env.WHATSAPP_TEMPLATE_LANG || 'en';
}

function prescriptionTemplateName(rx) {
  const isDoc = rxMediaType(rx) === 'document';
  if (isDoc) {
    return process.env.WHATSAPP_TEMPLATE_PRESCRIPTION_DOC || process.env.WHATSAPP_TEMPLATE_PRESCRIPTION;
  }
  return process.env.WHATSAPP_TEMPLATE_PRESCRIPTION;
}

function visitUpdateTemplateName() {
  return process.env.WHATSAPP_TEMPLATE_VISIT_UPDATE || null;
}

function templateSetupHint() {
  return 'Set WHATSAPP_TEMPLATE_PRESCRIPTION (and WHATSAPP_TEMPLATE_PRESCRIPTION_DOC for PDFs) in .env — create & approve templates in Meta Business Manager.';
}

/** Body params: patient name, clinic, visit date, procedure. */
function visitTemplateParams(profile, plainRecord) {
  const clinic = process.env.CLINIC_NAME || 'Smirk Dental';
  const name = profile.name || 'there';
  return [name, clinic, plainRecord.date, plainRecord.procedureText.slice(0, 500)];
}

async function sendVisitViaTemplate(patientWa, bodyParams, rx) {
  const lang = templateLang();

  if (rx) {
    const templateName = prescriptionTemplateName(rx);
    if (!templateName) {
      throw Object.assign(new Error(templateSetupHint()), { code: 'TEMPLATE_REQUIRED' });
    }
    const mediaId = await resolveRxMediaId(rx);
    const isDoc = rxMediaType(rx) === 'document';
    await sendTemplate(patientWa, templateName, lang, bodyParams, {
      strict: true,
      headerMedia: {
        kind: isDoc ? 'document' : 'image',
        mediaId,
        filename: rx.filename,
      },
    });
    return;
  }

  const templateName = visitUpdateTemplateName();
  if (!templateName) {
    throw Object.assign(new Error(templateSetupHint()), { code: 'TEMPLATE_REQUIRED' });
  }
  await sendTemplate(patientWa, templateName, lang, bodyParams, { strict: true });
}

async function sendVisitViaSession(patientWa, summary, rx) {
  await sendText(patientWa, summary, { strict: true });
  if (rx) {
    await deliverPrescriptionMedia(patientWa, rx, summary);
  }
}

async function notifyPatientVisitRecord(profile, record) {
  const patientWa = patientWaTo(profile.phone);
  if (!patientWa) {
    throw new Error('Patient phone number missing');
  }

  const plainRecord = record?.toObject ? record.toObject() : record;
  const rx = plainRecord.prescription;
  const clinic = process.env.CLINIC_NAME || 'Smirk Dental';
  const name = profile.name || 'there';
  const summary = `🦷 ${clinic}\n\nHi ${name},\n\n📋 Prescription — ${plainRecord.date}\nProcedure: ${plainRecord.procedureText}`;
  const bodyParams = visitTemplateParams(profile, plainRecord);

  const hasTemplate = rx ? !!prescriptionTemplateName(rx) : !!visitUpdateTemplateName();

  // Approved templates work any time — use them when configured.
  if (hasTemplate) {
    await sendVisitViaTemplate(patientWa, bodyParams, rx);
    return;
  }

  // Fallback: free-form messages (only within Meta's 24-hour window).
  try {
    await sendVisitViaSession(patientWa, summary, rx);
  } catch (err) {
    if (isServiceWindowError(err)) {
      throw Object.assign(new Error(`Patient is outside WhatsApp's 24-hour reply window. ${templateSetupHint()}`), {
        code: 'TEMPLATE_REQUIRED',
      });
    }
    if (rx) {
      console.error('Prescription media send failed:', err.message || err);
      throw new Error(`Could not deliver prescription file: ${err.message || 'send failed'}`);
    }
    throw err;
  }
}

async function findProfileByPhone(phone) {
  const digits = normalizeStoredPhone(phone);
  if (!digits) return null;
  const legacy = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : null;
  const query = legacy ? { $or: [{ phone: digits }, { phone: legacy }] } : { phone: digits };
  return PatientProfile.findOne(query).lean();
}

async function findOrCreateProfile(phone, nameHint) {
  const digits = normalizeStoredPhone(phone);
  if (!digits) {
    throw Object.assign(new Error('Invalid phone number'), { code: 'VALIDATION' });
  }

  const legacy = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : null;
  let profile = await PatientProfile.findOne(
    legacy ? { $or: [{ phone: digits }, { phone: legacy }] } : { phone: digits }
  );
  if (profile) {
    if (profile.phone !== digits) {
      profile.phone = digits;
    }
    if (nameHint?.trim() && !profile.name) {
      profile.name = nameHint.trim().slice(0, 100);
    }
    await profile.save();
    return profile;
  }

  let name = nameHint?.trim() || null;
  if (!name) {
    const recent = await Appointment.find().select('phone name date').sort({ date: -1 }).limit(100).lean();
    const appt = recent.find((a) => normalizeStoredPhone(a.phone) === digits);
    name = appt?.name?.trim() || null;
  }

  profile = await PatientProfile.create({
    phone: digits,
    name: name?.slice(0, 100),
  });
  return profile;
}

/** Recent distinct patients from profiles + completed appointments. */
async function listRecentPatients(limit = 10) {
  const cap = Math.min(20, Math.max(1, limit));

  const profiles = await PatientProfile.find().sort({ updatedAt: -1 }).limit(cap).lean();
  const byPhone = {};
  for (const p of profiles) {
    byPhone[p.phone] = { phone: p.phone, name: p.name || 'Patient', profileId: String(p._id) };
  }

  const completed = await Appointment.find({ status: 'completed' })
    .select('phone name date')
    .sort({ date: -1 })
    .limit(50)
    .lean();

  for (const a of completed) {
    const w = normalizeStoredPhone(a.phone);
    if (!w || byPhone[w]) continue;
    byPhone[w] = { phone: w, name: a.name?.trim() || 'Patient', profileId: null };
    if (Object.keys(byPhone).length >= cap) break;
  }

  return Object.values(byPhone).slice(0, cap);
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive name search across profiles and appointments (deduped by phone). */
async function searchPatientsByName(query, limit = 10) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];

  const cap = Math.min(20, Math.max(1, limit));
  const regex = new RegExp(escapeRegex(q), 'i');
  const byPhone = {};

  const profiles = await PatientProfile.find({ name: regex }).sort({ updatedAt: -1 }).limit(cap).lean();
  for (const p of profiles) {
    byPhone[p.phone] = { phone: p.phone, name: p.name || 'Patient', profileId: String(p._id) };
  }

  const appts = await Appointment.find({ name: regex })
    .select('phone name date')
    .sort({ date: -1 })
    .limit(100)
    .lean();

  for (const a of appts) {
    const w = normalizeStoredPhone(a.phone);
    if (!w || byPhone[w]) continue;
    byPhone[w] = { phone: w, name: a.name?.trim() || 'Patient', profileId: null };
    if (Object.keys(byPhone).length >= cap) break;
  }

  return Object.values(byPhone).slice(0, cap);
}

async function getVisitHistory(profileId, limit = 10) {
  return PatientVisitRecord.find({ patientProfileId: profileId })
    .sort({ date: -1, createdAt: -1 })
    .limit(limit)
    .lean();
}

async function getVisitRecordById(recordId, profileId) {
  return PatientVisitRecord.findOne({ _id: recordId, patientProfileId: profileId }).lean();
}

async function sendPrescriptionFileToWa(waId, record) {
  const rx = record.prescription;
  if (!rx) {
    throw Object.assign(new Error('Prescription file not found'), { code: 'NOT_FOUND' });
  }
  const caption = `${record.date} — ${record.procedureText}`;
  await deliverPrescriptionMedia(waId, rx, caption);
}

async function resendVisitToPatient(profile, record) {
  await notifyPatientVisitRecord(profile, record);
}

async function addVisitRecord({
  profileId,
  date,
  procedureText,
  prescription,
  medicinesText,
  createdByWaId,
  geminiConfidence,
}) {
  const profile = await PatientProfile.findById(profileId);
  if (!profile) throw Object.assign(new Error('Patient not found'), { code: 'NOT_FOUND' });

  const proc = procedureText?.trim().slice(0, 500);
  if (!proc || proc.length < 2) {
    throw Object.assign(new Error('Procedure is required'), { code: 'VALIDATION' });
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw Object.assign(new Error('Visit date is required'), { code: 'VALIDATION' });
  }

  const record = await PatientVisitRecord.create({
    patientProfileId: profileId,
    date,
    procedureText: proc,
    ...(prescription ? { prescription } : {}),
    ...(medicinesText ? { medicinesText: medicinesText.trim().slice(0, 3000) } : {}),
    createdByWaId,
    geminiConfidence,
  });

  if (!profile.lastVisitDate || date > profile.lastVisitDate) {
    profile.lastVisitDate = date;
    await profile.save();
  }

  return { profile, record };
}

function formatAdminPrescription(profile, record) {
  const procedure = record.procedureText || '';
  return {
    recordId: String(record._id),
    profileId: String(profile._id),
    patientName: profile.name || '',
    patientPhone: profile.phone,
    date: record.date,
    procedure: procedure === 'Prescription' ? '' : procedure,
    medicines: parseMedicinesText(record.medicinesText),
    hasPdf: !!record.prescription?.storagePath,
  };
}

/** Admin prescription for a patient on a given visit date (if any). */
async function findAdminPrescriptionByPhoneAndDate(phone, date) {
  const profile = await findProfileByPhone(phone);
  if (!profile) return null;

  const record = await PatientVisitRecord.findOne({
    patientProfileId: profile._id,
    date,
    createdByWaId: 'admin',
    'prescription.storagePath': { $exists: true, $ne: '' },
  })
    .sort({ updatedAt: -1 })
    .lean();

  if (!record) return null;

  return formatAdminPrescription(profile, record);
}

async function getAdminPrescriptionById(recordId) {
  const record = await PatientVisitRecord.findById(recordId).lean();
  if (!record || record.createdByWaId !== 'admin' || !record.prescription?.storagePath) {
    return null;
  }

  const profile = await PatientProfile.findById(record.patientProfileId).lean();
  if (!profile) return null;

  return formatAdminPrescription(profile, record);
}

/** Attach prescriptionRecordId to each appointment when an admin rx exists for that phone+date. */
async function attachPrescriptionRecordIds(appointments) {
  if (!Array.isArray(appointments) || !appointments.length) return appointments;

  const phoneSet = new Set();
  for (const appt of appointments) {
    const digits = normalizeStoredPhone(appt.phone);
    if (digits) phoneSet.add(digits);
  }
  if (!phoneSet.size) return appointments;

  const phones = [...phoneSet];
  const legacyPhones = phones
    .filter((p) => p.length === 12 && p.startsWith('91'))
    .map((p) => p.slice(2));
  const profileQuery = legacyPhones.length
    ? { $or: [{ phone: { $in: phones } }, { phone: { $in: legacyPhones } }] }
    : { phone: { $in: phones } };

  const profiles = await PatientProfile.find(profileQuery).lean();
  if (!profiles.length) return appointments;

  const profileByPhone = {};
  for (const profile of profiles) {
    profileByPhone[profile.phone] = profile;
    if (profile.phone.length === 12 && profile.phone.startsWith('91')) {
      profileByPhone[profile.phone.slice(2)] = profile;
    }
  }

  const profileIds = profiles.map((p) => p._id);
  const dates = [...new Set(appointments.map((a) => a.date).filter(Boolean))];

  const records = await PatientVisitRecord.find({
    patientProfileId: { $in: profileIds },
    date: { $in: dates },
    createdByWaId: 'admin',
    'prescription.storagePath': { $exists: true, $ne: '' },
  })
    .select('_id patientProfileId date updatedAt')
    .sort({ updatedAt: -1 })
    .lean();

  const recordByProfileDate = {};
  for (const record of records) {
    const key = `${record.patientProfileId}_${record.date}`;
    if (!recordByProfileDate[key]) {
      recordByProfileDate[key] = String(record._id);
    }
  }

  return appointments.map((appt) => {
    const digits = normalizeStoredPhone(appt.phone);
    const profile = digits ? profileByPhone[digits] : null;
    const prescriptionRecordId = profile
      ? recordByProfileDate[`${profile._id}_${appt.date}`] || null
      : null;
    return { ...appt, prescriptionRecordId };
  });
}

async function updateAdminPrescription(recordId, { patientName, patientPhone, medicines, date, procedureText, prescription }) {
  const record = await PatientVisitRecord.findById(recordId);
  if (!record) throw Object.assign(new Error('Prescription not found'), { code: 'NOT_FOUND' });
  if (record.createdByWaId !== 'admin') {
    throw Object.assign(new Error('Only admin prescriptions can be edited here'), { code: 'VALIDATION' });
  }

  const profile = await PatientProfile.findById(record.patientProfileId);
  if (!profile) throw Object.assign(new Error('Patient not found'), { code: 'NOT_FOUND' });

  if (patientName?.trim()) profile.name = patientName.trim().slice(0, 100);
  const normalizedPhone = normalizeStoredPhone(patientPhone);
  if (normalizedPhone) profile.phone = normalizedPhone;
  await profile.save();

  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) record.date = date;
  record.procedureText = (procedureText?.trim() || 'Prescription').slice(0, 500);
  record.medicinesText = Array.isArray(medicines)
    ? serializeMedicines(medicines).slice(0, 3000)
    : String(medicines || '').trim().slice(0, 3000);
  record.prescription = prescription;
  await record.save();

  if (!profile.lastVisitDate || record.date > profile.lastVisitDate) {
    profile.lastVisitDate = record.date;
    await profile.save();
  }

  return { profile, record };
}

/** @deprecated use notifyPatientVisitRecord */
const forwardPrescriptionToPatient = notifyPatientVisitRecord;

module.exports = {
  findProfileByPhone,
  findOrCreateProfile,
  listRecentPatients,
  searchPatientsByName,
  getVisitHistory,
  getVisitRecordById,
  sendPrescriptionFileToWa,
  resendVisitToPatient,
  addVisitRecord,
  notifyPatientVisitRecord,
  forwardPrescriptionToPatient,
  findAdminPrescriptionByPhoneAndDate,
  getAdminPrescriptionById,
  attachPrescriptionRecordIds,
  updateAdminPrescription,
  phoneDigits,
  patientWaTo,
  normalizeStoredPhone,
};
