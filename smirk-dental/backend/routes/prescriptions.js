const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { requireAdmin } = require('../middleware/adminAuth');
const { generatePrescriptionPdf } = require('../services/prescriptionPdf');
const { serializeMedicines, parseMedicinesBody } = require('../services/medicinesFormat');
const {
  findOrCreateProfile,
  addVisitRecord,
  notifyPatientVisitRecord,
  findAdminPrescriptionByPhoneAndDate,
  getAdminPrescriptionById,
  normalizeStoredPhone,
  updateAdminPrescription,
} = require('../services/patientProfileService');

const router = express.Router();

const validate = (rules) => [
  ...rules,
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()[0].msg,
        errors: errors.array(),
      });
    }
    next();
  },
];

const prescriptionFields = [
  body('patientName').trim().isLength({ min: 2, max: 100 }).withMessage('Patient name is required'),
  body('patientPhone').trim().isLength({ min: 10, max: 15 }).withMessage('Valid phone number is required'),
  body('medicines').custom((value) => {
    const list = parseMedicinesBody(value);
    if (!list.length) throw new Error('Add at least one medicine');
    for (const m of list) {
      if (!m.name) throw new Error('Medicine name is required');
      if (m.name.length > 200) throw new Error('Medicine name is too long');
      if (m.schedule.length > 300) throw new Error('Schedule is too long');
    }
    return true;
  }),
  body('date')
    .optional()
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage('Date must be YYYY-MM-DD'),
  body('procedure')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Procedure details must be 500 characters or less'),
];

async function saveAndNotify({ record, profile, isUpdate }) {
  let whatsappSent = false;
  let whatsappError = null;

  try {
    await notifyPatientVisitRecord(profile, record);
    whatsappSent = true;
  } catch (notifyErr) {
    whatsappError = notifyErr.message || 'WhatsApp delivery failed';
    console.error('Prescription saved but WhatsApp failed:', whatsappError);
  }

  const verb = isUpdate ? 'updated' : 'saved';
  return {
    success: true,
    message: whatsappSent
      ? `Prescription ${verb} and sent to patient on WhatsApp.`
      : `Prescription ${verb} but could not reach patient on WhatsApp.`,
    whatsappSent,
    whatsappError,
    recordId: String(record._id),
    profileId: String(profile._id),
  };
}

router.get(
  '/lookup',
  requireAdmin,
  validate([
    query('phone').custom((value, { req }) => {
      const normalized = normalizeStoredPhone(value);
      if (!normalized) throw new Error('Valid phone number is required');
      req.normalizedPhone = normalized;
      return true;
    }),
    query('date').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Date must be YYYY-MM-DD'),
  ]),
  async (req, res) => {
    try {
      const prescription = await findAdminPrescriptionByPhoneAndDate(req.normalizedPhone, req.query.date);
      return res.json({ success: true, prescription });
    } catch (err) {
      console.error('GET /prescriptions/lookup error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Lookup failed' });
    }
  }
);

router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const prescription = await getAdminPrescriptionById(req.params.id);
    if (!prescription) {
      return res.status(404).json({ success: false, message: 'Prescription not found' });
    }
    return res.json({ success: true, prescription });
  } catch (err) {
    console.error('GET /prescriptions/:id error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not load prescription' });
  }
});

router.post('/', requireAdmin, validate(prescriptionFields), async (req, res) => {
  try {
    const patientName = req.body.patientName.trim();
    const patientPhone = req.body.patientPhone.trim();
    const medicines = parseMedicinesBody(req.body.medicines);
    const date = req.body.date || new Date().toLocaleDateString('en-CA');
    const procedureText = req.body.procedure?.trim() || 'Prescription';

    const existing = await findAdminPrescriptionByPhoneAndDate(patientPhone, date);
    if (existing?.recordId) {
      return res.status(409).json({
        success: false,
        message: 'A prescription already exists for this patient on this date. Open it to edit.',
        recordId: existing.recordId,
      });
    }

    const profile = await findOrCreateProfile(patientPhone, patientName);

    const rxFile = await generatePrescriptionPdf({
      patientName,
      patientPhone,
      medicines,
      date,
      procedure: procedureText === 'Prescription' ? '' : procedureText,
    });

    const { record } = await addVisitRecord({
      profileId: profile._id,
      date,
      procedureText,
      medicinesText: serializeMedicines(medicines),
      prescription: {
        mediaType: rxFile.mediaType,
        mimeType: rxFile.mimeType,
        filename: rxFile.filename,
        storagePath: rxFile.storagePath,
      },
      createdByWaId: 'admin',
    });

    const result = await saveAndNotify({ record, profile, isUpdate: false });
    return res.json(result);
  } catch (err) {
    console.error('POST /prescriptions error:', err);
    const status = err.code === 'VALIDATION' ? 400 : err.code === 'NOT_FOUND' ? 404 : 500;
    return res.status(status).json({
      success: false,
      message: err.message || 'Could not create prescription',
    });
  }
});

router.put('/:id', requireAdmin, validate(prescriptionFields), async (req, res) => {
  try {
    const patientName = req.body.patientName.trim();
    const patientPhone = req.body.patientPhone.trim();
    const medicines = parseMedicinesBody(req.body.medicines);
    const date = req.body.date || new Date().toLocaleDateString('en-CA');
    const procedureText = req.body.procedure?.trim() || 'Prescription';

    const rxFile = await generatePrescriptionPdf({
      patientName,
      patientPhone,
      medicines,
      date,
      procedure: procedureText === 'Prescription' ? '' : procedureText,
    });

    const { profile, record } = await updateAdminPrescription(req.params.id, {
      patientName,
      patientPhone,
      medicines,
      date,
      procedureText,
      prescription: {
        mediaType: rxFile.mediaType,
        mimeType: rxFile.mimeType,
        filename: rxFile.filename,
        storagePath: rxFile.storagePath,
      },
    });

    const result = await saveAndNotify({ record, profile, isUpdate: true });
    return res.json(result);
  } catch (err) {
    console.error('PUT /prescriptions/:id error:', err);
    const status = err.code === 'VALIDATION' ? 400 : err.code === 'NOT_FOUND' ? 404 : 500;
    return res.status(status).json({
      success: false,
      message: err.message || 'Could not update prescription',
    });
  }
});

module.exports = router;
