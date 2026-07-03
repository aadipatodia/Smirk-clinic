const express = require('express');
const { body, validationResult } = require('express-validator');
const { requireAdmin } = require('../middleware/adminAuth');
const { generatePrescriptionPdf } = require('../services/prescriptionPdf');
const {
  findOrCreateProfile,
  addVisitRecord,
  notifyPatientVisitRecord,
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

router.post(
  '/',
  requireAdmin,
  validate([
    body('patientName').trim().isLength({ min: 2, max: 100 }).withMessage('Patient name is required'),
    body('patientPhone').trim().isLength({ min: 10, max: 15 }).withMessage('Valid phone number is required'),
    body('medicines').trim().isLength({ min: 2, max: 3000 }).withMessage('Medicines are required'),
    body('date')
      .optional()
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage('Date must be YYYY-MM-DD'),
  ]),
  async (req, res) => {
    try {
      const patientName = req.body.patientName.trim();
      const patientPhone = req.body.patientPhone.trim();
      const medicines = req.body.medicines.trim();
      const date = req.body.date || new Date().toLocaleDateString('en-CA');
      const procedureText = 'Prescription';

      const profile = await findOrCreateProfile(patientPhone, patientName);

      const rxFile = await generatePrescriptionPdf({
        patientName,
        patientPhone,
        medicines,
        date,
      });

      const { record } = await addVisitRecord({
        profileId: profile._id,
        date,
        procedureText,
        prescription: {
          mediaType: rxFile.mediaType,
          mimeType: rxFile.mimeType,
          filename: rxFile.filename,
          storagePath: rxFile.storagePath,
        },
        createdByWaId: 'admin',
      });

      let whatsappSent = false;
      let whatsappError = null;

      try {
        await notifyPatientVisitRecord(profile, record);
        whatsappSent = true;
      } catch (notifyErr) {
        whatsappError = notifyErr.message || 'WhatsApp delivery failed';
        console.error('Prescription saved but WhatsApp failed:', whatsappError);
      }

      return res.json({
        success: true,
        message: whatsappSent
          ? 'Prescription saved and sent to patient on WhatsApp.'
          : 'Prescription saved but could not reach patient on WhatsApp.',
        whatsappSent,
        whatsappError,
        recordId: String(record._id),
        profileId: String(profile._id),
      });
    } catch (err) {
      console.error('POST /prescriptions error:', err);
      const status = err.code === 'VALIDATION' ? 400 : err.code === 'NOT_FOUND' ? 404 : 500;
      return res.status(status).json({
        success: false,
        message: err.message || 'Could not create prescription',
      });
    }
  }
);

module.exports = router;
