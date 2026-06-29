const PatientProfile = require('../models/PatientProfile');
const PatientVisitRecord = require('../models/PatientVisitRecord');
const Appointment = require('../models/Appointment');
const { phoneDigits } = require('./appointmentService');
const { todayYmdIst } = require('./whatsapp/dateIst');
const { sendText } = require('./whatsapp/outbound');
const { uploadMediaFromFile } = require('./whatsapp/media');
const fs = require('fs');
const path = require('path');

async function findProfileByPhone(phone) {
  const digits = phoneDigits(phone);
  if (!digits || digits.length < 10) return null;
  return PatientProfile.findOne({ phone: digits }).lean();
}

async function findOrCreateProfile(phone, nameHint) {
  const digits = phoneDigits(phone);
  if (!digits || digits.length < 10) {
    throw Object.assign(new Error('Invalid phone number'), { code: 'VALIDATION' });
  }

  let profile = await PatientProfile.findOne({ phone: digits });
  if (profile) {
    if (nameHint?.trim() && !profile.name) {
      profile.name = nameHint.trim().slice(0, 100);
      await profile.save();
    }
    return profile;
  }

  let name = nameHint?.trim() || null;
  if (!name) {
    const recent = await Appointment.find().select('phone name date').sort({ date: -1 }).limit(100).lean();
    const appt = recent.find((a) => phoneDigits(a.phone) === digits);
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
    const w = phoneDigits(a.phone);
    if (!w || w.length < 10 || byPhone[w]) continue;
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
    const w = phoneDigits(a.phone);
    if (!w || w.length < 10 || byPhone[w]) continue;
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

async function addVisitRecord({
  profileId,
  date,
  procedureText,
  prescription,
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
    createdByWaId,
    geminiConfidence,
  });

  if (!profile.lastVisitDate || date > profile.lastVisitDate) {
    profile.lastVisitDate = date;
    await profile.save();
  }

  return { profile, record };
}

async function notifyPatientVisitRecord(profile, record) {
  const patientWa = profile.phone;
  if (!patientWa) return;

  const clinic = process.env.CLINIC_NAME || 'Smirk Dental';
  const name = profile.name || 'there';
  const rx = record.prescription;

  if (!rx?.storagePath || !fs.existsSync(rx.storagePath)) {
    await sendText(
      patientWa,
      `🦷 ${clinic}\n\nHi ${name},\n\nVisit record — ${record.date}\nProcedure: ${record.procedureText}\n\n— Smirk Dental Clinic`
    );
    return;
  }

  const mediaId = await uploadMediaFromFile(rx.storagePath, rx.mimeType || 'application/octet-stream');
  const { sendImageByMediaId, sendDocumentByMediaId } = require('./whatsapp/outbound');

  const caption = `🦷 ${clinic}\nHi ${name},\n\n📋 Prescription — ${record.date}\nProcedure: ${record.procedureText}`;

  if (rx.type === 'document') {
    await sendDocumentByMediaId(patientWa, mediaId, rx.filename || path.basename(rx.storagePath), caption);
  } else {
    await sendImageByMediaId(patientWa, mediaId, caption);
  }
}

/** @deprecated use notifyPatientVisitRecord */
const forwardPrescriptionToPatient = notifyPatientVisitRecord;

module.exports = {
  findProfileByPhone,
  findOrCreateProfile,
  listRecentPatients,
  searchPatientsByName,
  getVisitHistory,
  addVisitRecord,
  notifyPatientVisitRecord,
  forwardPrescriptionToPatient,
  phoneDigits,
};
