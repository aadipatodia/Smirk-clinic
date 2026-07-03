const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { requireAdmin } = require('../middleware/adminAuth');
const { generatePrescriptionPdf } = require('../services/prescriptionPdf');
const { normalizeMedicinesList, serializeMedicines } = require('../services/medicinesFormat');
const {
  findOrCreateProfile,
  addVisitRecord,
  notifyPatientVisitRecord,
  findAdminPrescriptionByPhoneAndDate,
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
  body('medicines').isArray({ min: 1 }).withMessage('Add at least one medicine'),
  body('medicines.*.name').trim().isLength({ min: 1, max: 200 }).withMessage('Medicine name is required'),
  body('medicines.*.schedule').optional().trim().isLength({ max: 300 }).withMessage('Schedule is too long'),
  body('date')
    .optional()
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage('Date must be YYYY-MM-DD'),
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
    query('phone').trim().isLength({ min: 10, max: 15 }).withMessage('Phone is required'),
    query('date').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Date must be YYYY-MM-DD'),
  ]),
  async (req, res) => {
    try {
      const prescription = await findAdminPrescriptionByPhoneAndDate(req.query.phone, req.query.date);
      return res.json({ success: true, prescription });
    } catch (err) {
      console.error('GET /prescriptions/lookup error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Lookup failed' });
    }
  }
);

router.post('/', requireAdmin, validate(prescriptionFields), async (req, res) => {
  try {
    const patientName = req.body.patientName.trim();
    const patientPhone = req.body.patientPhone.trim();
    const medicines = normalizeMedicinesList(req.body.medicines);
    const date = req.body.date || new Date().toLocaleDateString('en-CA');

    const existing = await findAdminPrescriptionByPhoneAndDate(patientPhone, date);
    if (existing?.recordId) {
      return res.status(409).json({
        success: false,
        message: 'A prescription already exists for this patient on this date. Open it to edit.',
        recordId: existing.recordId,
      });
    }

    const profile = await findOrCreateProfile(patientPhone, patientName);

    const rxFile = await generatePrescriptionPdf({ patientName, patientPhone, medicines, date });

    const { record } = await addVisitRecord({
      profileId: profile._id,
      date,
      procedureText: 'Prescription',
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
    const medicines = normalizeMedicinesList(req.body.medicines);
    const date = req.body.date || new Date().toLocaleDateString('en-CA');

    const rxFile = await generatePrescriptionPdf({ patientName, patientPhone, medicines, date });

    const { profile, record } = await updateAdminPrescription(req.params.id, {
      patientName,
      patientPhone,
      medicines,
      date,
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
