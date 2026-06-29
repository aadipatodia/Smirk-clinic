const {
  findOrCreateProfile,
  listRecentPatients,
  searchPatientsByName,
  getVisitHistory,
  getVisitRecordById,
  sendPrescriptionFileToWa,
  resendVisitToPatient,
  addVisitRecord,
  notifyPatientVisitRecord,
  phoneDigits,
  findProfileByPhone,
} = require('../../patientProfileService');
const { parseVisitInput } = require('../../geminiExtract');
const { downloadAndStoreMedia } = require('../media');
const { sendReplyButtons, sendText, sendListMessage } = require('../outbound');
const { formatPhoneForAppointment } = require('../../appointmentService');
const { isDoctorMenuEscape, returnDoctorToMainMenu, doctorMenuEscapeHint } = require('../doctorEscape');
const fs = require('fs');

function doctorMainMenu() {
  const { sendDoctorMainMenu } = require('./doctorFlow');
  return sendDoctorMainMenu;
}

function parsePhoneFromText(text) {
  const d = String(text || '').replace(/\D/g, '');
  if (d.length === 10 && /^[6-9]/.test(d)) return phoneDigits(formatPhoneForAppointment(d));
  if (d.length === 12 && d.startsWith('91')) return d;
  if (d.length >= 10 && d.length <= 15) return d;
  return null;
}

function validProcedure(text) {
  const s = String(text || '').trim();
  return s.length >= 2 ? s.slice(0, 500) : null;
}

function validDate(text) {
  const s = String(text || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function newPendingVisit(mode) {
  return { mode, procedure: null, date: null, prescription: null };
}

/** Returns missing mandatory fields for the current visit mode. */
function missingVisitFields(pending) {
  if (!pending) return ['procedure', 'date'];
  const missing = [];
  if (!validProcedure(pending.procedure)) missing.push('procedure');
  if (!validDate(pending.date)) missing.push('date');
  if (pending.mode === 'prescription' && !pending.prescription?.storagePath) {
    missing.push('prescription');
  }
  return missing;
}

function patientCtxOnly(ctx) {
  return {
    profileId: ctx.profileId,
    profilePhone: ctx.profilePhone,
    profileName: ctx.profileName,
    nameSearchQuery: ctx.nameSearchQuery,
    nameSearchMatches: ctx.nameSearchMatches,
  };
}

async function startPatientProfileMenu(waId) {
  await sendListMessage(
    waId,
    `Patient profiles — find a patient to add prescriptions or view history.\n\n${doctorMenuEscapeHint()}`,
    'Open',
    [
      { id: 'DPF_SEARCH', title: 'Find by phone', description: 'Enter patient number' },
      { id: 'DPF_NAME', title: 'Find by name', description: 'Search patient name' },
      { id: 'DPF_RECENT', title: 'Recent patients', description: 'Last visits' },
      { id: 'D_MENU', title: 'Back to menu', description: 'Doctor main menu' },
    ],
    'Patient profile'
  );
  return { flow: 'doctor_profile', step: 'menu', resetContext: true, lastActionId: 'D_PROF' };
}

async function sendRecentPatientList(waId) {
  const list = await listRecentPatients(10);
  if (!list.length) {
    await sendText(waId, 'No patients found yet. Use Find by phone or Find by name.');
    return startPatientProfileMenu(waId);
  }
  const rows = list.map((p) => ({
    id: `DPF_PICK:${p.phone}`,
    title: (p.name || 'Patient').slice(0, 24),
    description: p.phone.slice(-10),
  }));
  await sendListMessage(waId, 'Pick a patient:', 'Pick patient', rows, 'Recent');
  return { flow: 'doctor_profile', step: 'pick_patient', resetContext: true, lastActionId: 'DPF_RECENT' };
}

async function sendNameSearchResults(waId, query, matches) {
  if (!matches.length) {
    await sendText(
      waId,
      `No patient found for "${query}".\n\nTry a different spelling, use Find by phone, or search with full name.`
    );
    return {
      flow: 'doctor_profile',
      step: 'search_name',
      resetContext: true,
      lastActionId: 'name_no_match',
    };
  }

  if (matches.length === 1) {
    return selectPatientByPhone(waId, matches[0].phone, matches[0].name);
  }

  const normalizedQuery = query.trim().toLowerCase();
  const sameNameCount = matches.filter(
    (p) => (p.name || '').trim().toLowerCase() === normalizedQuery
  ).length;
  const duplicateNames =
    matches.filter((p, i, arr) => {
      const n = (p.name || '').trim().toLowerCase();
      return arr.filter((x) => (x.name || '').trim().toLowerCase() === n).length > 1;
    }).length > 0;

  let header = `Found ${matches.length} patients matching "${query}". Pick the correct one:`;
  if (sameNameCount > 1 || duplicateNames) {
    header = [
      `Multiple patients match "${query}".`,
      'Please select the correct one by phone number:',
    ].join('\n');
  }

  const rows = matches.slice(0, 10).map((p) => ({
    id: `DPF_PICK:${p.phone}`,
    title: (p.name || 'Patient').slice(0, 24),
    description: `📞 …${p.phone.slice(-10)}`,
  }));

  await sendListMessage(waId, header, 'Pick patient', rows, 'Search results');
  if (sameNameCount > 1 || duplicateNames) {
    await sendText(waId, "Or type the patient's phone number (10 digits) to select the correct one.");
  }
  return {
    flow: 'doctor_profile',
    step: 'pick_patient',
    contextPatch: { nameSearchQuery: query, nameSearchMatches: matches },
    lastActionId: 'name_matches',
  };
}

async function showPatientActions(waId, ctx) {
  const name = ctx.profileName || 'Patient';
  const phone = ctx.profilePhone || '';
  await sendListMessage(
    waId,
    `${name}\n📞 ${phone}\n\nWhat would you like to do?`,
    'Actions',
    [
      { id: 'DPF_ADD', title: 'Add prescription', description: 'Photo/PDF + details' },
      { id: 'DPF_PROC', title: 'Procedure details', description: 'Type procedure & date' },
      { id: 'DPF_HIST', title: 'View history', description: 'Past visits' },
      { id: 'DPF_BACK', title: 'Find another', description: 'Back to search' },
    ],
    'Patient'
  );
  return {
    flow: 'doctor_profile',
    step: 'patient_actions',
    contextPatch: patientCtxOnly(ctx),
    lastActionId: 'patient_selected',
  };
}

async function showVisitHistoryList(waId, ctx) {
  const profileId = ctx.profileId;
  if (!profileId) {
    await sendText(waId, 'Session expired. Open Patient profile again.');
    return returnDoctorToMainMenu(waId);
  }

  const visits = await getVisitHistory(profileId, 10);
  if (!visits.length) {
    await sendText(waId, 'No visit records yet for this patient.');
    return showPatientActions(waId, ctx);
  }

  const rows = visits.map((v) => ({
    id: `DPF_VISIT:${v._id}`,
    title: v.date.slice(0, 24),
    description: `${v.procedureText}${v.prescription?.storagePath ? ' 📎' : ''}`.slice(0, 72),
  }));

  await sendListMessage(
    waId,
    `📋 Past visits — ${ctx.profileName || 'Patient'}\n\nPick a visit to view procedure and prescription:`,
    'Pick visit',
    rows,
    'History'
  );
  return {
    flow: 'doctor_profile',
    step: 'pick_visit',
    contextPatch: patientCtxOnly(ctx),
    lastActionId: 'DPF_HIST',
  };
}

async function showVisitDetail(waId, ctx, visitId) {
  const visit = await getVisitRecordById(visitId, ctx.profileId);
  if (!visit) {
    await sendText(waId, 'Visit not found.');
    return showVisitHistoryList(waId, ctx);
  }

  const hasRx =
    visit.prescription?.storagePath && fs.existsSync(visit.prescription.storagePath);

  await sendText(
    waId,
    [
      `📋 ${ctx.profileName || 'Patient'}`,
      '',
      `Date: ${visit.date}`,
      `Procedure: ${visit.procedureText}`,
      hasRx ? 'Prescription: on file 📎' : 'Prescription: none (procedure only)',
    ].join('\n')
  );

  const rows = [];
  if (hasRx) {
    rows.push({
      id: `DPF_RXDOC:${visitId}`,
      title: 'Send me file',
      description: 'Prescription on WhatsApp',
    });
    rows.push({
      id: `DPF_RXPAT:${visitId}`,
      title: 'Resend to patient',
      description: 'Forward prescription',
    });
  }
  rows.push({ id: 'DPF_HIST_BACK', title: 'Back to history', description: 'All visits' });
  rows.push({ id: 'DPF_BACK', title: 'Patient actions', description: 'Main patient menu' });

  await sendListMessage(waId, 'What would you like to do?', 'Actions', rows, 'Visit');
  return {
    flow: 'doctor_profile',
    step: 'visit_detail',
    contextPatch: { ...patientCtxOnly(ctx), selectedVisitId: String(visitId) },
    lastActionId: 'visit_open',
  };
}

async function handleResendPrescriptionToDoctor(waId, ctx, visitId) {
  const visit = await getVisitRecordById(visitId, ctx.profileId);
  if (!visit) {
    await sendText(waId, 'Visit not found.');
    return showVisitHistoryList(waId, ctx);
  }
  try {
    await sendPrescriptionFileToWa(waId, visit);
    await sendText(waId, '✅ Prescription sent to you above.');
  } catch (e) {
    await sendText(waId, `Could not send file: ${e.message}`);
  }
  return showVisitDetail(waId, ctx, visitId);
}

async function handleResendPrescriptionToPatient(waId, ctx, visitId) {
  const visit = await getVisitRecordById(visitId, ctx.profileId);
  if (!visit) {
    await sendText(waId, 'Visit not found.');
    return showVisitHistoryList(waId, ctx);
  }
  const profile = await findProfileByPhone(ctx.profilePhone);
  if (!profile) {
    await sendText(waId, 'Patient profile not found.');
    return showVisitDetail(waId, ctx, visitId);
  }
  try {
    await resendVisitToPatient(profile, visit);
    await sendText(waId, `✅ Sent to patient (${ctx.profileName || 'patient'}).`);
  } catch (e) {
    await sendText(waId, `Could not send to patient: ${e.message}`);
  }
  return showVisitDetail(waId, ctx, visitId);
}

/** @deprecated use showVisitHistoryList */
async function showVisitHistory(waId, ctx) {
  return showVisitHistoryList(waId, ctx);
}

async function startAddPrescription(waId, ctx) {
  await sendText(
    waId,
    [
      `Add prescription for ${ctx.profileName || 'this patient'}.`,
      '',
      'Send everything in one message if you can:',
      '• Prescription photo or PDF',
      '• Procedure done (in caption or text)',
      '• Visit date — any format (e.g. 24/6/26, 24 June 2026)',
      '',
      'Only missing details will be asked.',
      '',
      doctorMenuEscapeHint(),
    ].join('\n')
  );
  return {
    flow: 'doctor_profile',
    step: 'collect_visit',
    contextPatch: { ...patientCtxOnly(ctx), pendingVisit: newPendingVisit('prescription') },
    lastActionId: 'DPF_ADD',
  };
}

async function startProcedureDetails(waId, ctx) {
  await sendText(
    waId,
    [
      `Procedure details for ${ctx.profileName || 'this patient'}.`,
      '',
      'Type procedure and date in one message — e.g.:',
      '"Root canal, 24 June 2026" or "Scaling done on 24/6/26"',
      '',
      doctorMenuEscapeHint(),
    ].join('\n')
  );
  return {
    flow: 'doctor_profile',
    step: 'collect_visit',
    contextPatch: { ...patientCtxOnly(ctx), pendingVisit: newPendingVisit('procedure_only') },
    lastActionId: 'DPF_PROC',
  };
}

async function promptMissingFields(waId, ctx, missing) {
  const labels = missing.map((m) => {
    if (m === 'prescription') return 'prescription photo/PDF';
    if (m === 'procedure') return 'procedure';
    if (m === 'date') return 'visit date';
    return m;
  });

  if (missing.length === 1) {
    if (missing[0] === 'prescription') {
      await sendText(waId, 'Still needed: prescription photo or PDF. Please send the file.');
    } else if (missing[0] === 'procedure') {
      await sendText(waId, 'Still needed: procedure. Type what was done — e.g. Root canal, Scaling.');
    } else if (missing[0] === 'date') {
      await sendText(
        waId,
        'Still needed: visit date. Type in any format — e.g. 24/6/26, 24 June 2026, yesterday.'
      );
    }
  } else {
    await sendText(
      waId,
      `Still needed: ${labels.join(', ')}.\n\nYou can send them together in one message.`
    );
  }

  return {
    flow: 'doctor_profile',
    step: 'collect_visit',
    contextPatch: ctx,
    lastActionId: 'need_fields',
  };
}

/** Merge Gemini parse result + optional prescription file into pending visit. */
function mergeParsedIntoPending(pendingVisit, parsed, prescriptionFile) {
  const merged = { ...pendingVisit };
  if (parsed.procedurePresent && parsed.procedure) {
    merged.procedure = parsed.procedure;
  }
  if (parsed.datePresent && parsed.date) {
    merged.date = parsed.date;
  }
  if (prescriptionFile) {
    merged.prescription = prescriptionFile;
  }
  return merged;
}

async function handleVisitDoctorInput(waId, ctx, { text, mediaEvent }) {
  let pendingVisit = ctx.pendingVisit || newPendingVisit('prescription');
  let prescriptionFile = null;
  let imageBase64 = null;
  let mimeType = null;
  let doctorText = text || '';

  if (mediaEvent) {
    await sendText(waId, 'Processing…');
    try {
      const stored = await downloadAndStoreMedia(mediaEvent.mediaId, {
        prefix: `p${ctx.profilePhone || 'rx'}`,
      });
      const isDoc = mediaEvent.kind === 'document';
      prescriptionFile = {
        mediaId: mediaEvent.mediaId,
        mimeType: stored.mimeType || mediaEvent.mimeType,
        filename: (isDoc ? mediaEvent.filename : null) || stored.filename,
        storagePath: stored.storagePath,
        type: isDoc ? 'document' : 'image',
      };
      mimeType = stored.mimeType || mediaEvent.mimeType;
      if (stored.buffer && (mimeType?.startsWith('image/') || mimeType === 'application/pdf')) {
        imageBase64 = stored.buffer.toString('base64');
      }
      if (mediaEvent.caption) doctorText = mediaEvent.caption;
    } catch (e) {
      await sendText(waId, `Could not download file: ${e.message}. Try again.`);
      return promptMissingFields(waId, ctx, missingVisitFields(pendingVisit));
    }
  }

  const hasPrescriptionFile = !!(prescriptionFile?.storagePath || pendingVisit.prescription?.storagePath);

  const parsed = await parseVisitInput({
    doctorText,
    imageBase64,
    mimeType,
    mode: pendingVisit.mode,
    hasPrescriptionFile,
    alreadyHave: {
      procedure: pendingVisit.procedure,
      date: pendingVisit.date,
    },
  });

  pendingVisit = mergeParsedIntoPending(pendingVisit, parsed, prescriptionFile);
  const nextCtx = { ...ctx, pendingVisit };
  const stillMissing = missingVisitFields(pendingVisit);

  if (!stillMissing.length) {
    const lines = ['Got it:', `• Procedure: ${pendingVisit.procedure}`, `• Date: ${pendingVisit.date}`];
    if (pendingVisit.mode === 'prescription') lines.push('• Prescription: attached');
    await sendText(waId, lines.join('\n'));
    return showVisitConfirm(waId, nextCtx);
  }

  const got = [];
  if (parsed.procedurePresent) got.push('procedure');
  if (parsed.datePresent) got.push('date');
  if (prescriptionFile) got.push('prescription');
  if (got.length) {
    await sendText(waId, `✅ Received: ${got.join(', ')}.`);
  }

  return promptMissingFields(waId, nextCtx, stillMissing);
}

async function showVisitConfirm(waId, ctx) {
  const pv = ctx.pendingVisit;
  const lines = [
    `Review for ${ctx.profileName || 'patient'}:`,
    '',
    `Procedure: ${pv.procedure}`,
    `Date: ${pv.date}`,
  ];
  if (pv.mode === 'prescription') {
    lines.push(`Prescription: ${pv.prescription?.filename || 'attached'}`);
    lines.push('', 'Confirm to save and send to patient.');
  } else {
    lines.push('', 'Confirm to save and notify patient.');
  }

  await sendReplyButtons(waId, lines.join('\n'), [
    { id: 'DPF_CONFIRM', title: 'Confirm' },
    { id: 'DPF_EDIT_PROC', title: 'Edit procedure' },
    { id: 'DPF_EDIT_DATE', title: 'Edit date' },
  ]);

  return {
    flow: 'doctor_profile',
    step: 'confirm_visit',
    contextPatch: ctx,
    lastActionId: 'ready_confirm',
  };
}

/** Prompt the next missing mandatory field, or show confirm if complete. */
async function advanceVisitWizard(waId, ctx) {
  const pv = ctx.pendingVisit;
  if (!pv) {
    await sendText(waId, 'Session expired. Start again.');
    return showPatientActions(waId, patientCtxOnly(ctx));
  }

  const missing = missingVisitFields(pv);
  if (!missing.length) return showVisitConfirm(waId, ctx);
  return promptMissingFields(waId, ctx, missing);
}

async function saveVisit(waId, ctx) {
  const pv = ctx.pendingVisit;
  if (!pv || !ctx.profileId) {
    await sendText(waId, 'Session expired. Start again from Patient profile.');
    await doctorMainMenu()(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'save_expired' };
  }

  const missing = missingVisitFields(pv);
  if (missing.length) {
    await sendText(waId, `Still missing: ${missing.join(', ')}.`);
    return advanceVisitWizard(waId, ctx);
  }

  try {
    const prescriptionPayload = pv.prescription
      ? {
          type: pv.prescription.type,
          mimeType: pv.prescription.mimeType,
          filename: pv.prescription.filename,
          storagePath: pv.prescription.storagePath,
          waMediaId: pv.prescription.mediaId,
        }
      : null;

    const { profile, record } = await addVisitRecord({
      profileId: ctx.profileId,
      date: pv.date,
      procedureText: pv.procedure,
      prescription: prescriptionPayload,
      createdByWaId: waId,
    });

    await notifyPatientVisitRecord(profile, record);

    await sendText(
      waId,
      `✅ Saved and sent to patient.\n\n${profile.name || 'Patient'}\n${record.date} — ${record.procedureText}`
    );

    return showPatientActions(waId, patientCtxOnly(ctx));
  } catch (e) {
    await sendText(waId, `Could not save: ${e.message}`);
    return {
      flow: 'doctor_profile',
      step: 'confirm_visit',
      contextPatch: ctx,
      lastActionId: 'save_fail',
    };
  }
}

async function selectPatientByPhone(waId, phone, nameHint) {
  const profile = await findOrCreateProfile(phone, nameHint);
  const ctx = {
    profileId: String(profile._id),
    profilePhone: profile.phone,
    profileName: profile.name || nameHint || 'Patient',
  };
  return showPatientActions(waId, ctx);
}

async function handleDoctorProfileFlow({ waId, event, ctx, session }) {
  const step = session?.step || 'menu';
  const kind = event.kind;
  const id = kind === 'button' ? event.buttonId : kind === 'list' ? event.rowId : '';

  if (kind === 'text' && isDoctorMenuEscape(event.body)) {
    return returnDoctorToMainMenu(waId);
  }

  if (kind === 'button' && (id === 'D_MENU' || id === 'DPF_CANCEL')) {
    return returnDoctorToMainMenu(waId);
  }

  if (kind === 'list' && id === 'DPF_BACK') {
    return startPatientProfileMenu(waId);
  }

  if (kind === 'list' && id === 'DPF_ADD') {
    if (!ctx.profileId) {
      await sendText(waId, 'Select a patient first.');
      return startPatientProfileMenu(waId);
    }
    return startAddPrescription(waId, ctx);
  }

  if (kind === 'list' && id === 'DPF_PROC') {
    if (!ctx.profileId) {
      await sendText(waId, 'Select a patient first.');
      return startPatientProfileMenu(waId);
    }
    return startProcedureDetails(waId, ctx);
  }

  if (kind === 'list' && id === 'DPF_HIST') {
    return showVisitHistoryList(waId, ctx);
  }

  if (kind === 'list' && id === 'DPF_HIST_BACK') {
    return showVisitHistoryList(waId, ctx);
  }

  if (kind === 'list' && id?.startsWith('DPF_VISIT:')) {
    const visitId = id.slice('DPF_VISIT:'.length);
    return showVisitDetail(waId, ctx, visitId);
  }

  if (kind === 'list' && id?.startsWith('DPF_RXDOC:')) {
    const visitId = id.slice('DPF_RXDOC:'.length);
    return handleResendPrescriptionToDoctor(waId, ctx, visitId);
  }

  if (kind === 'list' && id?.startsWith('DPF_RXPAT:')) {
    const visitId = id.slice('DPF_RXPAT:'.length);
    return handleResendPrescriptionToPatient(waId, ctx, visitId);
  }

  if (kind === 'button' && id === 'DPF_CONFIRM') {
    return saveVisit(waId, ctx);
  }

  if (kind === 'button' && id === 'DPF_EDIT_PROC') {
    await sendText(waId, 'Type the procedure (e.g. Root canal, Scaling):');
    return {
      flow: 'doctor_profile',
      step: 'collect_visit',
      contextPatch: ctx,
      lastActionId: 'DPF_EDIT_PROC',
    };
  }

  if (kind === 'button' && id === 'DPF_EDIT_DATE') {
    await sendText(waId, 'Type the visit date in any format (e.g. 24/6/26, 24 June 2026):');
    return {
      flow: 'doctor_profile',
      step: 'collect_visit',
      contextPatch: ctx,
      lastActionId: 'DPF_EDIT_DATE',
    };
  }

  const visitInputSteps = new Set(['collect_visit', 'upload_prescription', 'enter_procedure', 'enter_date']);

  if (kind === 'text' && visitInputSteps.has(step) && ctx.pendingVisit) {
    return handleVisitDoctorInput(waId, ctx, { text: event.body });
  }

  if (kind === 'text' && step === 'search_phone') {
    const phone = parsePhoneFromText(event.body);
    if (!phone) {
      await sendText(waId, 'Invalid phone. Send 10-digit mobile or +91…');
      return {
        flow: 'doctor_profile',
        step: 'search_phone',
        contextPatch: ctx,
        lastActionId: 'bad_phone',
      };
    }
    return selectPatientByPhone(waId, phone);
  }

  if (kind === 'text' && step === 'search_name') {
    const query = String(event.body || '').trim();
    if (query.length < 2) {
      await sendText(waId, 'Name too short. Send at least 2 characters.');
      return {
        flow: 'doctor_profile',
        step: 'search_name',
        contextPatch: ctx,
        lastActionId: 'bad_name',
      };
    }
    const matches = await searchPatientsByName(query, 10);
    return sendNameSearchResults(waId, query, matches);
  }

  if (kind === 'text' && step === 'pick_patient' && ctx.nameSearchMatches?.length) {
    const phone = parsePhoneFromText(event.body);
    if (phone) {
      const matches = ctx.nameSearchMatches;
      const match = matches.find((p) => p.phone === phone || p.phone.endsWith(phone.slice(-10)));
      if (!match) {
        await sendText(
          waId,
          'That number is not in the search results. Pick from the list or search again.'
        );
        return sendNameSearchResults(waId, ctx.nameSearchQuery || '', matches);
      }
      return selectPatientByPhone(waId, match.phone, match.name);
    }
  }

  if (kind === 'text' && step === 'clarify_phone') {
    const phone = parsePhoneFromText(event.body);
    if (!phone) {
      await sendText(waId, 'Invalid phone. Send 10-digit mobile or +91… to pick the correct patient.');
      return {
        flow: 'doctor_profile',
        step: 'clarify_phone',
        contextPatch: ctx,
        lastActionId: 'bad_clarify_phone',
      };
    }
    const expected = ctx.nameSearchMatches || [];
    const match = expected.find((p) => p.phone === phone || p.phone.endsWith(phone.slice(-10)));
    if (!match && expected.length) {
      await sendText(
        waId,
        'That number is not in the search results. Pick from the list or search again.'
      );
      return sendNameSearchResults(waId, ctx.nameSearchQuery || '', expected);
    }
    return selectPatientByPhone(waId, phone, match?.name || ctx.nameSearchQuery);
  }

  if ((kind === 'image' || kind === 'document') && visitInputSteps.has(step) && ctx.pendingVisit) {
    if (!ctx.profileId) {
      await sendText(waId, 'Select a patient first.');
      return startPatientProfileMenu(waId);
    }
    return handleVisitDoctorInput(waId, ctx, { mediaEvent: event });
  }

  if (kind === 'list' && id === 'DPF_SEARCH') {
    await sendText(waId, 'Send the patient phone number (10 digits or +91…):');
    return {
      flow: 'doctor_profile',
      step: 'search_phone',
      resetContext: true,
      lastActionId: 'DPF_SEARCH',
    };
  }

  if (kind === 'list' && id === 'DPF_NAME') {
    await sendText(waId, 'Send the patient name (first name, last name, or partial):');
    return {
      flow: 'doctor_profile',
      step: 'search_name',
      resetContext: true,
      lastActionId: 'DPF_NAME',
    };
  }

  if (kind === 'list' && id === 'DPF_RECENT') {
    return sendRecentPatientList(waId);
  }

  if (kind === 'list' && id?.startsWith('DPF_PICK:')) {
    const phone = id.slice('DPF_PICK:'.length);
    return selectPatientByPhone(waId, phone);
  }

  if (kind === 'image' || kind === 'document') {
    await sendText(
      waId,
      'Open Patient profile → pick a patient → Add prescription, then send the file.'
    );
    return startPatientProfileMenu(waId);
  }

  return startPatientProfileMenu(waId);
}

module.exports = {
  startPatientProfileMenu,
  handleDoctorProfileFlow,
};
