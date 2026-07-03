const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { UPLOAD_DIR } = require('./whatsapp/media');

const CLINIC = {
  name: 'Smirk Dental Clinic & Implant Centre',
  addressLines: [
    'C6/7, 6096, Ground Floor, Gate 5, C-6',
    'Vasant Kunj, New Delhi – 110070',
  ],
};

const DOCTOR = {
  name: 'Dr. Mehak Gupta',
  phone: '8130972879',
};

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

/**
 * Generate a prescription PDF and save to uploads/prescriptions/.
 * @returns {Promise<{ storagePath: string, filename: string, mimeType: string, mediaType: 'document' }>}
 */
function generatePrescriptionPdf({ patientName, patientPhone, medicines, date }) {
  ensureUploadDir();

  const filename = `rx_admin_${Date.now()}.pdf`;
  const storagePath = path.join(UPLOAD_DIR, filename);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(storagePath);

    doc.pipe(stream);

    doc.fontSize(16).font('Helvetica-Bold').text(CLINIC.name, { align: 'center' });
    doc.fontSize(10).font('Helvetica');
    for (const line of CLINIC.addressLines) {
      doc.text(line, { align: 'center' });
    }

    doc.moveDown(1.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#cccccc');
    doc.moveDown(1.5);

    doc.fontSize(14).font('Helvetica-Bold').text('Prescription', { align: 'center' });
    doc.moveDown(1);

    doc.fontSize(11).font('Helvetica');
    doc.text(`Date: ${date}`);
    doc.text(`Patient: ${patientName}`);
    doc.text(`Phone: ${patientPhone}`);
    doc.moveDown(1);

    doc.font('Helvetica-Bold').text('Rx');
    doc.moveDown(0.3);
    doc.font('Helvetica');
    for (const line of String(medicines || '').trim().split('\n')) {
      if (line.trim()) doc.text(`• ${line.trim()}`);
    }

    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#cccccc');
    doc.moveDown(1);

    doc.font('Helvetica-Bold').text(DOCTOR.name);
    doc.font('Helvetica').text(`Phone: ${DOCTOR.phone}`);

    doc.end();

    stream.on('finish', () => {
      resolve({
        storagePath,
        filename,
        mimeType: 'application/pdf',
        mediaType: 'document',
      });
    });
    stream.on('error', reject);
    doc.on('error', reject);
  });
}

module.exports = { generatePrescriptionPdf, CLINIC, DOCTOR };
