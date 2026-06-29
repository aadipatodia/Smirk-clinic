const {
  findOrCreateProfile,
  listRecentPatients,
  searchPatientsByName,
  getVisitHistory,
  addVisitRecord,
  forwardPrescriptionToPatient,
  phoneDigits,
} = require('../../patientProfileService');
const { extractPrescriptionInfo } = require('../../geminiExtract');
const { downloadAndStoreMedia } = require('../media');
const { sendReplyButtons, sendText, sendListMessage } = require('../outbound');
const { formatPhoneForAppointment } = require('../../appointmentService');

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

async function startPatientProfileMenu(waId) {
  await sendListMessage(
    waId,
    'Patient profiles — find a patient to add prescriptions or view history.',
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
  const duplicateNames = matches.filter((p, i, arr) => {
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
    await sendText(waId, 'Or type the patient\'s phone number (10 digits) to select the correct one.');
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
      { id: 'DPF_ADD', title: 'Add prescription', description: 'Photo or PDF' },
      { id: 'DPF_HIST', title: 'View history', description: 'Past visits' },
      { id: 'DPF_BACK', title: 'Find another', description: 'Back to search' },
    ],
    'Patient'
  );
  return {
    flow: 'doctor_profile',
    step: 'patient_actions',
    contextPatch: ctx,
    lastActionId: 'patient_selected',
  };
}

async function showVisitHistory(waId, ctx) {
  const profileId = ctx.profileId;
  if (!profileId) {
    await sendText(waId, 'Session expired. Open Patient profile again.');
    return doctorMainMenu()(waId).then(() => ({
      flow: 'idle',
      step: '0',
      resetContext: true,
      lastActionId: 'hist_expired',
    }));
  }

  const visits = await getVisitHistory(profileId, 8);
  if (!visits.length) {
    await sendText(waId, 'No visit records yet for this patient.');
    return showPatientActions(waId, ctx);
  }

  let msg = `📋 Visit history — ${ctx.profileName || 'Patient'}\n\n`;
  visits.forEach((v, i) => {
    msg += `${i + 1}. ${v.date} — ${v.procedureText}\n`;
  });
  await sendText(waId, msg.slice(0, 4000));
  return showPatientActions(waId, ctx);
}

async function promptPrescriptionUpload(waId, ctx) {
  await sendText(
    waId,
    `Send a photo or PDF of the prescription for ${ctx.profileName || 'this patient'}.\n\nOptional: add a caption with procedure and date.\n\nExample: Root canal, 2026-06-24`
  );
  return {
    flow: 'doctor_profile',
    step: 'upload_prescription',
    contextPatch: ctx,
    lastActionId: 'DPF_ADD',
  };
}

async function processPrescriptionMedia(waId, event, ctx) {
  const mediaId = event.mediaId;
  const mimeType = event.mimeType;
  const caption = event.caption || '';
  const isDoc = event.kind === 'document';
  const filename = isDoc ? event.filename : null;

  await sendText(waId, 'Processing prescription…');

  let stored;
  try {
    stored = await downloadAndStoreMedia(mediaId, { prefix: `p${ctx.profilePhone || 'rx'}` });
  } catch (e) {
    await sendText(waId, `Could not download file: ${e.message}. Try again.`);
    return promptPrescriptionUpload(waId, ctx);
  }

  let imageBase64 = null;
  if (!isDoc && stored.buffer) {
    imageBase64 = stored.buffer.toString('base64');
  } else if (isDoc && mimeType === 'application/pdf' && stored.buffer) {
    imageBase64 = stored.buffer.toString('base64');
  }

  const extracted = await extractPrescriptionInfo({
    caption,
    imageBase64,
    mimeType: stored.mimeType || mimeType,
  });

  const pending = {
    ...ctx,
    pendingRx: {
      mediaId,
      mimeType: stored.mimeType || mimeType,
      filename: filename || stored.filename,
      storagePath: stored.storagePath,
      type: isDoc ? 'document' : 'image',
      procedure: extracted.procedure,
      date: extracted.date,
      confidence: extracted.confidence,
      caption,
    },
  };

  const confNote =
    extracted.confidence < 0.6 ? '\n\n⚠️ Low confidence — please verify before confirming.' : '';

  await sendReplyButtons(
    waId,
    [
      `Detected for ${ctx.profileName || 'patient'}:`,
      '',
      `Procedure: ${extracted.procedure}`,
      `Date: ${extracted.date}`,
      confNote,
      '',
      'Confirm to save and send to patient.',
    ].join('\n'),
    [
      { id: 'DPF_CONFIRM', title: 'Confirm' },
      { id: 'DPF_EDIT_PROC', title: 'Edit procedure' },
      { id: 'DPF_EDIT_DATE', title: 'Edit date' },
    ]
  );

  return {
    flow: 'doctor_profile',
    step: 'confirm_extract',
    contextPatch: pending,
    lastActionId: 'rx_extracted',
  };
}

async function saveAndForwardPrescription(waId, ctx) {
  const rx = ctx.pendingRx;
  if (!rx || !ctx.profileId) {
    await sendText(waId, 'Session expired. Start again from Patient profile.');
    await doctorMainMenu()(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'save_expired' };
  }

  try {
    const { profile, record } = await addVisitRecord({
      profileId: ctx.profileId,
      date: rx.date,
      procedureText: rx.procedure,
      prescription: {
        type: rx.type,
        mimeType: rx.mimeType,
        filename: rx.filename,
        storagePath: rx.storagePath,
        waMediaId: rx.mediaId,
      },
      createdByWaId: waId,
      geminiConfidence: rx.confidence,
    });

    await forwardPrescriptionToPatient(profile, record);

    await sendText(
      waId,
      `✅ Saved and sent to patient.\n\n${profile.name || 'Patient'}\n${record.date} — ${record.procedureText}`
    );

    const nextCtx = {
      profileId: ctx.profileId,
      profilePhone: ctx.profilePhone,
      profileName: ctx.profileName,
    };
    return showPatientActions(waId, nextCtx);
  } catch (e) {
    await sendText(waId, `Could not save: ${e.message}`);
    return {
      flow: 'doctor_profile',
      step: 'confirm_extract',
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

  if (kind === 'button' && (id === 'D_MENU' || id === 'DPF_CANCEL')) {
    await doctorMainMenu()(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: id };
  }

  if (kind === 'list' && id === 'DPF_BACK') {
    return startPatientProfileMenu(waId);
  }

  if (kind === 'list' && id === 'DPF_ADD') {
    if (!ctx.profileId) {
      await sendText(waId, 'Select a patient first.');
      return startPatientProfileMenu(waId);
    }
    return promptPrescriptionUpload(waId, ctx);
  }

  if (kind === 'list' && id === 'DPF_HIST') {
    return showVisitHistory(waId, ctx);
  }

  if (kind === 'button' && id === 'DPF_CONFIRM') {
    return saveAndForwardPrescription(waId, ctx);
  }

  if (kind === 'button' && id === 'DPF_EDIT_PROC') {
    await sendText(waId, 'Type the procedure name (e.g. Root canal, Scaling):');
    return {
      flow: 'doctor_profile',
      step: 'edit_procedure',
      contextPatch: ctx,
      lastActionId: 'DPF_EDIT_PROC',
    };
  }

  if (kind === 'button' && id === 'DPF_EDIT_DATE') {
    await sendText(waId, 'Type the visit date as YYYY-MM-DD (e.g. 2026-06-24):');
    return {
      flow: 'doctor_profile',
      step: 'edit_date',
      contextPatch: ctx,
      lastActionId: 'DPF_EDIT_DATE',
    };
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

  if (kind === 'text' && step === 'edit_procedure') {
    const proc = String(event.body || '').trim().slice(0, 500);
    if (proc.length < 2) {
      await sendText(waId, 'Procedure too short. Try again.');
      return { flow: 'doctor_profile', step: 'edit_procedure', contextPatch: ctx, lastActionId: 'bad_proc' };
    }
    const pending = { ...ctx.pendingRx, procedure: proc };
    const nextCtx = { ...ctx, pendingRx: pending };
    await sendReplyButtons(
      waId,
      `Updated:\nProcedure: ${pending.procedure}\nDate: ${pending.date}\n\nConfirm?`,
      [
        { id: 'DPF_CONFIRM', title: 'Confirm' },
        { id: 'DPF_EDIT_PROC', title: 'Edit procedure' },
        { id: 'DPF_EDIT_DATE', title: 'Edit date' },
      ]
    );
    return {
      flow: 'doctor_profile',
      step: 'confirm_extract',
      contextPatch: nextCtx,
      lastActionId: 'proc_edited',
    };
  }

  if (kind === 'text' && step === 'edit_date') {
    const d = String(event.body || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      await sendText(waId, 'Use format YYYY-MM-DD (e.g. 2026-06-24).');
      return { flow: 'doctor_profile', step: 'edit_date', contextPatch: ctx, lastActionId: 'bad_date' };
    }
    const pending = { ...ctx.pendingRx, date: d };
    const nextCtx = { ...ctx, pendingRx: pending };
    await sendReplyButtons(
      waId,
      `Updated:\nProcedure: ${pending.procedure}\nDate: ${pending.date}\n\nConfirm?`,
      [
        { id: 'DPF_CONFIRM', title: 'Confirm' },
        { id: 'DPF_EDIT_PROC', title: 'Edit procedure' },
        { id: 'DPF_EDIT_DATE', title: 'Edit date' },
      ]
    );
    return {
      flow: 'doctor_profile',
      step: 'confirm_extract',
      contextPatch: nextCtx,
      lastActionId: 'date_edited',
    };
  }

  if ((kind === 'image' || kind === 'document') && step === 'upload_prescription') {
    if (!ctx.profileId) {
      await sendText(waId, 'Select a patient first.');
      return startPatientProfileMenu(waId);
    }
    return processPrescriptionMedia(waId, event, ctx);
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
    await sendText(waId, 'Open Patient profile → pick a patient → Add prescription, then send the file.');
    return startPatientProfileMenu(waId);
  }

  return startPatientProfileMenu(waId);
}

module.exports = {
  startPatientProfileMenu,
  handleDoctorProfileFlow,
};
