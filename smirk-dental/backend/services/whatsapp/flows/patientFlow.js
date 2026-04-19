const {
  getNextBookableDates,
  getAvailableSlots,
  getAvailableSlotsForReschedule,
  createAppointment,
  formatPhoneForAppointment,
  resolvePatientNameForWa,
  recordReviewRating,
  listUpcomingAppointmentsForWa,
  cancelAppointmentForWa,
  rescheduleAppointmentForWa,
  apptBelongsToWa,
} = require('../../appointmentService');
const Appointment = require('../../../models/Appointment');
const { sendReplyButtons, sendText, sendListMessage } = require('../outbound');

const CLINIC_MAPS_URL =
  process.env.CLINIC_MAPS_URL ||
  'https://www.google.com/maps?q=28.5248,77.1589&z=18';

const RVW_RE = /^RVW:([1-5]):([a-f\d]{24})$/i;
const P_A_RE = /^P_A:([a-f\d]{24})$/i;

function patientMenuBody() {
  const name = process.env.CLINIC_NAME || 'Smirk Dental';
  return `🦷 ${name}\n\nChoose an option:`;
}

async function sendPatientMainMenu(to) {
  await sendReplyButtons(to, patientMenuBody(), [
    { id: 'P_BOOK', title: 'Book visit' },
    { id: 'P_MY', title: 'My visits' },
    { id: 'P_LOC', title: 'Location' },
  ]);
}

function shortDateLabel(ymd) {
  const [, m, d] = ymd.split('-');
  return `${d}/${m}`;
}

async function sendDatePickList(waId) {
  const dates = getNextBookableDates(10);
  const rows = dates.map((ymd) => ({
    id: `B_D:${ymd}`,
    title: shortDateLabel(ymd),
    description: ymd,
  }));
  await sendListMessage(
    waId,
    'Pick a date for your visit (IST). Sundays are not available.',
    'Pick date',
    rows,
    'Book visit'
  );
}

async function sendRescheduleDateList(waId) {
  const dates = getNextBookableDates(10);
  const rows = dates.map((ymd) => ({
    id: `R_D:${ymd}`,
    title: shortDateLabel(ymd),
    description: ymd,
  }));
  await sendListMessage(
    waId,
    'Pick a new date for your visit (IST).',
    'Pick date',
    rows,
    'Reschedule'
  );
}

async function sendTimeChunk(waId, slots, offset, opts = {}) {
  const resched = !!opts.reschedule;
  const tp = resched ? 'R_T:' : 'B_T:';
  const tofp = resched ? 'R_TOFF:' : 'B_TOFF:';
  const bk = resched ? 'R_BKDATE' : 'B_BKDATE';
  const chunk = slots.slice(offset, offset + 10);
  const rows = chunk.map((t, i) => ({
    id: `${tp}${offset + i}`,
    title: t.slice(0, 24),
  }));
  const breakNote =
    '⏸️ Break: 2:00–3:00 PM — no appointments in that window.';
  await sendListMessage(
    waId,
    `Available times (tap one):\nShowing ${offset + 1}–${offset + chunk.length} of ${slots.length}\n\n${breakNote}`,
    'Pick time',
    rows,
    'Select time'
  );
  if (slots.length > offset + chunk.length) {
    await sendReplyButtons(waId, 'More times on the next row, or go back.', [
      { id: `${tofp}${offset + chunk.length}`, title: 'More times' },
      { id: bk, title: 'Change date' },
      { id: 'P_MENU', title: 'Main menu' },
    ]);
  } else if (offset > 0) {
    await sendReplyButtons(waId, 'Need earlier slots?', [
      { id: `${tofp}${Math.max(0, offset - 10)}`, title: 'Earlier times' },
      { id: bk, title: 'Change date' },
      { id: 'P_MENU', title: 'Main menu' },
    ]);
  } else {
    await sendReplyButtons(waId, 'You can change the date or return to the main menu.', [
      { id: bk, title: 'Change date' },
      { id: 'P_MENU', title: 'Main menu' },
      { id: resched ? 'R_ABOOK' : 'B_ABOOK', title: resched ? 'Cancel' : 'Cancel book' },
    ]);
  }
}

async function sendMyVisitsList(waId) {
  const list = await listUpcomingAppointmentsForWa(waId);
  if (!list.length) {
    await sendText(waId, 'You have no upcoming confirmed visits.');
    await sendPatientMainMenu(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'P_MY_empty' };
  }
  const rows = list.map((a) => ({
    id: `P_A:${a._id}`,
    title: `${shortDateLabel(a.date)} ${a.time}`.slice(0, 24),
    description: `${a.name}`.slice(0, 72),
  }));
  await sendListMessage(
    waId,
    'Your upcoming visits — tap one to reschedule or cancel.',
    'My visits',
    rows,
    'Visits'
  );
  return { flow: 'patient_mine', step: 'listed', resetContext: true, lastActionId: 'P_MY' };
}

async function handleReviewPick(waId, rowId) {
  const m = String(rowId).match(RVW_RE);
  if (!m) {
    await sendPatientMainMenu(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'rvw_bad' };
  }
  const stars = parseInt(m[1], 10);
  const apptId = m[2];
  const appt = await Appointment.findById(apptId).lean();
  const phoneNorm = String(appt?.phone || '').replace(/\D/g, '');
  if (!appt || phoneNorm !== waId) {
    await sendText(waId, 'We could not match this rating to your phone number.');
    await sendPatientMainMenu(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'rvw_nomatch' };
  }
  if (appt.reviewSubmittedAt) {
    await sendText(waId, 'Thanks — we already have your feedback for this visit.');
    await sendPatientMainMenu(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'rvw_dup' };
  }
  await recordReviewRating(apptId, stars);
  await sendText(waId, 'Thank you! Your rating was saved.');
  await sendPatientMainMenu(waId);
  return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'rvw_ok' };
}

async function handleBookingLikeFlow({ waId, event, ctx, mode }) {
  const resched = mode === 'reschedule';
  const dateP = resched ? 'R_D:' : 'B_D:';
  const timeP = resched ? 'R_T:' : 'B_T:';
  const toffP = resched ? 'R_TOFF:' : 'B_TOFF:';
  const confirmB = resched ? 'R_CONFIRM' : 'B_CONFIRM';
  const bkDateB = resched ? 'R_BKDATE' : 'B_BKDATE';
  const flowName = resched ? 'patient_reschedule' : 'patient_book';

  const kind = event.kind;
  const id = kind === 'button' ? event.buttonId : kind === 'list' ? event.rowId : '';

  if (resched && !ctx.rescheduleId) {
    await sendText(waId, 'Reschedule session expired. Open My visits and try again.');
    await sendPatientMainMenu(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'rsv_lost' };
  }

  if (kind === 'button' && (id === 'P_MENU' || id === 'B_ABOOK' || id === 'R_ABOOK')) {
    await sendPatientMainMenu(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: id || 'menu' };
  }

  if (kind === 'button' && id === confirmB) {
    const date = ctx.bookDate;
    const time = ctx.pendingTime;
    if (!date || !time || (resched && !ctx.rescheduleId)) {
      await sendText(waId, 'Session expired. Please start again.');
      if (resched) await sendRescheduleDateList(waId);
      else await sendDatePickList(waId);
      return {
        flow: flowName,
        step: 'pick_date',
        contextPatch: resched
          ? { rescheduleId: ctx.rescheduleId, bookDate: null, pendingTime: null, availableSlots: null }
          : {},
        resetContext: !resched,
        lastActionId: 'expired',
      };
    }
    try {
      if (resched) {
        await rescheduleAppointmentForWa(ctx.rescheduleId, waId, date, time);
        await sendText(waId, `✅ Rescheduled to ${date} at ${time}.`);
      } else {
        const phone = formatPhoneForAppointment(waId);
        const name = await resolvePatientNameForWa(waId);
        const appt = await createAppointment({ name, phone, date, time, notes: 'WhatsApp' });
        await sendText(
          waId,
          `✅ Booked!\n\n${appt.date} at ${appt.time}\n\nWe will see you at the clinic.`
        );
      }
    } catch (e) {
      if (e.code === 'CONFLICT' || e.message === 'SLOT_TAKEN') {
        await sendText(waId, 'That slot was just taken. Please pick another time.');
      } else {
        await sendText(waId, resched ? 'Could not reschedule. Try again or call the clinic.' : 'Booking failed. Please try again or use the website.');
      }
      const slotsFn = resched
        ? () => getAvailableSlotsForReschedule(date, ctx.rescheduleId)
        : () => getAvailableSlots(date);
      const slots = await slotsFn();
      if (!slots.length) {
        if (resched) await sendRescheduleDateList(waId);
        else await sendDatePickList(waId);
        return {
          flow: flowName,
          step: 'pick_date',
          contextPatch: resched
            ? {
                rescheduleId: ctx.rescheduleId,
                bookDate: null,
                pendingTime: null,
                availableSlots: null,
                timeOffset: null,
              }
            : {},
          resetContext: !resched,
          lastActionId: 'fail',
        };
      }
      await sendTimeChunk(waId, slots, 0, { reschedule: resched });
      return {
        flow: flowName,
        step: 'pick_time',
        contextPatch: {
          bookDate: date,
          availableSlots: slots,
          timeOffset: 0,
          ...(resched ? { rescheduleId: ctx.rescheduleId } : {}),
        },
        lastActionId: 'retry',
      };
    }
    await sendPatientMainMenu(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: resched ? 'rescheduled' : 'booked' };
  }

  if (kind === 'button' && id === bkDateB) {
    if (resched) await sendRescheduleDateList(waId);
    else await sendDatePickList(waId);
    return {
      flow: flowName,
      step: 'pick_date',
      contextPatch: {
        bookDate: null,
        pendingTime: null,
        availableSlots: null,
        timeOffset: null,
        ...(resched ? { rescheduleId: ctx.rescheduleId } : {}),
      },
      lastActionId: id,
    };
  }

  const toff = typeof id === 'string' && id.startsWith(toffP) ? parseInt(id.slice(toffP.length), 10) : NaN;
  if (kind === 'button' && !Number.isNaN(toff) && ctx.availableSlots?.length) {
    await sendTimeChunk(waId, ctx.availableSlots, toff, { reschedule: resched });
    return {
      flow: flowName,
      step: 'pick_time',
      contextPatch: { timeOffset: toff, ...(resched ? { rescheduleId: ctx.rescheduleId } : {}) },
      lastActionId: id,
    };
  }

  if (kind === 'list' && id.startsWith(dateP)) {
    const date = id.slice(dateP.length);
    const slots = resched
      ? await getAvailableSlotsForReschedule(date, ctx.rescheduleId)
      : await getAvailableSlots(date);
    if (!slots.length) {
      await sendText(waId, 'No free slots that day. Pick another date.');
      if (resched) await sendRescheduleDateList(waId);
      else await sendDatePickList(waId);
      return {
        flow: flowName,
        step: 'pick_date',
        contextPatch: resched
          ? {
              rescheduleId: ctx.rescheduleId,
              bookDate: null,
              pendingTime: null,
              availableSlots: null,
              timeOffset: null,
            }
          : {},
        resetContext: !resched,
        lastActionId: 'noslot',
      };
    }
    await sendTimeChunk(waId, slots, 0, { reschedule: resched });
    return {
      flow: flowName,
      step: 'pick_time',
      contextPatch: {
        bookDate: date,
        availableSlots: slots,
        timeOffset: 0,
        pendingTime: null,
        ...(resched ? { rescheduleId: ctx.rescheduleId } : {}),
      },
      lastActionId: date,
    };
  }

  if (kind === 'list' && id.startsWith(timeP)) {
    const idx = parseInt(id.slice(timeP.length), 10);
    const slots = ctx.availableSlots || [];
    const time = slots[idx];
    if (!time) {
      await sendText(waId, 'That time is no longer valid. Please choose again.');
      await sendPatientMainMenu(waId);
      return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'bad_idx' };
    }
    await sendReplyButtons(
      waId,
      `${resched ? 'Confirm new time?' : 'Confirm booking?'}\n\n📅 ${ctx.bookDate}\n🕐 ${time}`,
      [
        { id: confirmB, title: 'Confirm' },
        { id: bkDateB, title: 'Change date' },
        { id: 'P_MENU', title: 'Main menu' },
      ]
    );
    return {
      flow: flowName,
      step: 'confirm',
      contextPatch: {
        pendingTime: time,
        ...(resched ? { rescheduleId: ctx.rescheduleId } : {}),
      },
      lastActionId: `pick_${idx}`,
    };
  }

  if (resched) await sendRescheduleDateList(waId);
  else await sendDatePickList(waId);
  return {
    flow: flowName,
    step: 'pick_date',
    resetContext: !resched,
    contextPatch: resched
      ? { rescheduleId: ctx.rescheduleId, bookDate: null, pendingTime: null, availableSlots: null }
      : {},
    lastActionId: 'recover',
  };
}

async function handleMyVisitListPick(waId, rowId, session) {
  const m = String(rowId).match(P_A_RE);
  if (!m) {
    await sendPatientMainMenu(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'bad_pick' };
  }
  const apptId = m[1];
  const appt = await Appointment.findById(apptId).lean();
  if (!appt || !apptBelongsToWa(appt, waId)) {
    await sendText(waId, 'That visit could not be found for your number.');
    await sendPatientMainMenu(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'bad_appt' };
  }
  await sendReplyButtons(
    waId,
    `Visit: ${appt.date} at ${appt.time}\n\nWhat would you like to do?`,
    [
      { id: 'P_RSV_GO', title: 'Reschedule' },
      { id: 'P_CXL_GO', title: 'Cancel visit' },
      { id: 'P_MY_MENU', title: 'Back to menu' },
    ]
  );
  return {
    flow: 'patient_mine',
    step: 'action',
    contextPatch: { selectedApptId: apptId },
    lastActionId: apptId,
  };
}

async function handlePatientAction({ waId, event, session }) {
  const ctx = session?.context && typeof session.context === 'object' ? session.context : {};
  const flow = session?.flow || 'idle';

  if (event.kind === 'list' && event.rowId && RVW_RE.test(event.rowId)) {
    return handleReviewPick(waId, event.rowId);
  }

  if (event.kind === 'list' && event.rowId && P_A_RE.test(event.rowId)) {
    return handleMyVisitListPick(waId, event.rowId, session);
  }

  if (flow === 'patient_reschedule') {
    return handleBookingLikeFlow({ waId, event, ctx, mode: 'reschedule' });
  }

  if (flow === 'patient_book') {
    return handleBookingLikeFlow({ waId, event, ctx, mode: 'book' });
  }

  if (event.kind === 'text') {
    await sendPatientMainMenu(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'text_open_menu' };
  }

  if (event.kind === 'list') {
    const rid = event.rowId || '';
    if (rid.startsWith('B_D:') || rid.startsWith('B_T:')) {
      return handleBookingLikeFlow({ waId, event, ctx, mode: 'book' });
    }
    if ((rid.startsWith('R_D:') || rid.startsWith('R_T:')) && flow === 'patient_reschedule') {
      return handleBookingLikeFlow({ waId, event, ctx, mode: 'reschedule' });
    }
    return handlePatientButton({ waId, buttonId: rid, session });
  }

  if (event.kind === 'button') {
    return handlePatientButton({ waId, buttonId: event.buttonId, session });
  }

  await sendText(waId, 'Please use the buttons on the last message to continue.');
  await sendPatientMainMenu(waId);
  return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'unsupported' };
}

async function handlePatientButton({ waId, buttonId, session }) {
  const flow = session?.flow || 'idle';
  const ctx = session?.context && typeof session.context === 'object' ? session.context : {};

  if (flow === 'patient_book') {
    return handleBookingLikeFlow({ waId, event: { kind: 'button', buttonId }, ctx, mode: 'book' });
  }

  if (flow === 'patient_reschedule') {
    return handleBookingLikeFlow({ waId, event: { kind: 'button', buttonId }, ctx, mode: 'reschedule' });
  }

  if (flow === 'patient_mine') {
    if (buttonId === 'P_MY_MENU' || buttonId === 'P_MENU') {
      await sendPatientMainMenu(waId);
      return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'P_MY_MENU' };
    }
    if (buttonId === 'P_CXL_GO') {
      const apptId = ctx.selectedApptId;
      if (!apptId) {
        await sendMyVisitsList(waId);
        return { flow: 'patient_mine', step: 'listed', resetContext: true, lastActionId: 'nocxl' };
      }
      await sendReplyButtons(
        waId,
        'Cancel this visit permanently?',
        [
          { id: 'P_CXL_YES', title: 'Yes, cancel' },
          { id: 'P_MY_MENU', title: 'No, keep it' },
        ]
      );
      return { flow: 'patient_mine', step: 'confirm_cancel', contextPatch: {}, lastActionId: 'P_CXL_GO' };
    }
    if (buttonId === 'P_CXL_YES') {
      const apptId = ctx.selectedApptId;
      const r = await cancelAppointmentForWa(apptId, waId);
      if (!r.ok) {
        await sendText(waId, 'Could not cancel that visit. It may already be cancelled.');
      } else {
        await sendText(waId, 'Your visit has been cancelled.');
      }
      await sendPatientMainMenu(waId);
      return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'P_CXL_YES' };
    }
    if (buttonId === 'P_RSV_GO') {
      const apptId = ctx.selectedApptId;
      if (!apptId) {
        await sendMyVisitsList(waId);
        return { flow: 'patient_mine', step: 'listed', resetContext: true, lastActionId: 'norsv' };
      }
      const appt = await Appointment.findById(apptId).lean();
      if (!appt || !apptBelongsToWa(appt, waId) || appt.status !== 'confirmed') {
        await sendText(waId, 'That visit is no longer available to reschedule.');
        await sendPatientMainMenu(waId);
        return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'bad_rsv' };
      }
      await sendRescheduleDateList(waId);
      return {
        flow: 'patient_reschedule',
        step: 'pick_date',
        resetContext: true,
        contextPatch: { rescheduleId: apptId },
        lastActionId: 'P_RSV_GO',
      };
    }
  }

  switch (buttonId) {
    case 'P_MENU':
      await sendPatientMainMenu(waId);
      return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'P_MENU' };

    case 'P_BOOK': {
      await sendDatePickList(waId);
      return {
        flow: 'patient_book',
        step: 'pick_date',
        resetContext: true,
        lastActionId: 'P_BOOK',
      };
    }

    case 'P_MY':
      return await sendMyVisitsList(waId);

    case 'P_LOC':
      await sendText(waId, `📍 Clinic location:\n${CLINIC_MAPS_URL}`);
      await sendPatientMainMenu(waId);
      return { flow: 'idle', step: '0', resetContext: true, lastActionId: buttonId };

    default:
      await sendPatientMainMenu(waId);
      return { flow: 'idle', step: '0', resetContext: true, lastActionId: buttonId || 'unknown' };
  }
}

module.exports = {
  sendPatientMainMenu,
  handlePatientAction,
};
