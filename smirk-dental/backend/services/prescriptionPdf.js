const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { UPLOAD_DIR } = require('./whatsapp/media');
const { parseMedicinesText, normalizeMedicinesList } = require('./medicinesFormat');

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

const PAGE_MARGIN = 50;
const FOOTER_HEIGHT = 55;

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

function medicineRows(medicines) {
  if (Array.isArray(medicines)) return normalizeMedicinesList(medicines);
  return parseMedicinesText(medicines);
}

function drawLabelValue(doc, label, value) {
  doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
  doc.font('Helvetica').text(value);
}

function drawFooter(doc) {
  const bottom = doc.page.height - PAGE_MARGIN;
  doc
    .moveTo(PAGE_MARGIN, bottom - FOOTER_HEIGHT + 8)
    .lineTo(doc.page.width - PAGE_MARGIN, bottom - FOOTER_HEIGHT + 8)
    .stroke('#cccccc');

  doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f2a38');
  doc.text(DOCTOR.name, PAGE_MARGIN, bottom - FOOTER_HEIGHT + 18);

  doc.font('Helvetica').fontSize(10).fillColor('#475569');
  doc.text(`Phone: ${DOCTOR.phone}`, PAGE_MARGIN, bottom - FOOTER_HEIGHT + 34);

  doc.fillColor('#000000');
}

function ensureSpaceForRow(doc, y, rowHeight) {
  const maxY = doc.page.height - PAGE_MARGIN - FOOTER_HEIGHT;
  if (y + rowHeight > maxY) {
    doc.addPage();
    return PAGE_MARGIN;
  }
  return y;
}

/**
 * Generate a prescription PDF and save to uploads/prescriptions/.
 * @param {{ patientName: string, patientPhone: string, medicines: Array<{name:string,schedule:string}>|string, date: string }}
 */
function generatePrescriptionPdf({ patientName, patientPhone, medicines, date }) {
  ensureUploadDir();

  const filename = `rx_admin_${Date.now()}.pdf`;
  const storagePath = path.join(UPLOAD_DIR, filename);
  const items = medicineRows(medicines);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
    const stream = fs.createWriteStream(storagePath);

    doc.pipe(stream);

    doc.fontSize(16).font('Helvetica-Bold').text(CLINIC.name, { align: 'center' });
    doc.fontSize(10).font('Helvetica');
    for (const line of CLINIC.addressLines) {
      doc.text(line, { align: 'center' });
    }

    doc.moveDown(1.5);
    doc.moveTo(PAGE_MARGIN, doc.y).lineTo(doc.page.width - PAGE_MARGIN, doc.y).stroke('#cccccc');
    doc.moveDown(1.5);

    doc.fontSize(14).font('Helvetica-Bold').text('Prescription', { align: 'center' });
    doc.moveDown(1);

    doc.fontSize(11);
    drawLabelValue(doc, 'Date', date);
    drawLabelValue(doc, 'Patient', patientName);
    drawLabelValue(doc, 'Phone', patientPhone);
    doc.moveDown(1.2);

    const col1X = PAGE_MARGIN;
    const col2X = PAGE_MARGIN + 230;
    const col1W = 210;
    const col2W = doc.page.width - PAGE_MARGIN - col2X;

    let y = doc.y;

    doc.font('Helvetica-Bold').fontSize(11).text('Medicines', col1X, y);
    y += 22;

    doc.fontSize(9).fillColor('#64748b');
    doc.text('Medicine name', col1X, y, { width: col1W });
    doc.text('When to take', col2X, y, { width: col2W });
    doc.fillColor('#000000');
    y += 16;

    doc.moveTo(col1X, y).lineTo(doc.page.width - PAGE_MARGIN, y).stroke('#e2e8f0');
    y += 10;

    doc.font('Helvetica').fontSize(10);

    for (const item of items) {
      const nameH = doc.heightOfString(item.name, { width: col1W });
      const schedH = doc.heightOfString(item.schedule || '—', { width: col2W });
      const rowH = Math.max(nameH, schedH, 14) + 10;

      y = ensureSpaceForRow(doc, y, rowH);

      doc.font('Helvetica-Bold').text(item.name, col1X, y, { width: col1W });
      doc.font('Helvetica').text(item.schedule || '—', col2X, y, { width: col2W });

      y += rowH;
      doc.moveTo(col1X, y - 4).lineTo(doc.page.width - PAGE_MARGIN, y - 4).stroke('#f1f5f9');
    }

    if (!items.length) {
      doc.text('—', col1X, y);
      y += 20;
    }

    y = ensureSpaceForRow(doc, y, 20);
    drawFooter(doc);

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
