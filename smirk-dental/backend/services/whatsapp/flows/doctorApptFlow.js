const Appointment = require('../../../models/Appointment');
const {
  getNextBookableDates,
  getAvailableSlots,
  getAvailableSlotsForReschedule,
  createAppointmentByClinic,
  listUpcomingConfirmedAppointments,
  cancelAppointmentByClinic,
  rescheduleAppointmentByClinic,
  formatPhoneForAppointment,
} = require('../../appointmentService');
const { notifyPatientAppointmentConfirmed } = require('../../patientNotifications');
const { sendReplyButtons, sendText, sendListMessage } = require('../outbound');

function doctorMainMenu() {
  const { sendDoctorMainMenu } = require('./doctorFlow');
  return sendDoctorMainMenu;
}

function shortDateLabel(ymd) {
  const [, m, d] = ymd.split('-');
  return `${d}/${m}`;
}

function sanitizePatientName(text) {
  const name = String(text || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 100) return null;
  if (!/[a-zA-Z\u0900-\u097F]/.test(name)) return null;
  return name;
}

function parsePhoneFromText(text) {
  const d = String(text || '').replace(/\D/g, '');
  if (d.length === 10 && /^[6-9]/.test(d)) return formatPhoneForAppointment(d);
  if (d.length === 12 && d.startsWith('91')) return `+${d}`;
  if (d.length >= 10 && d.length <= 15) return `+${d}`;
  return null;
}

async function sendDoctorBookDateList(waId) {
  const dates = getNextBookableDates(10);
  const rows = dates.map((ymd) => ({
    id: `DK_D:${ymd}`,
    title: shortDateLabel(ymd),
    description: ymd,
  }));
  await sendListMessage(
    waId,
    'Pick appointment date (IST).',
    'Pick date',
    rows,
    'Book patient'
  );
}

async function sendDoctorBookTimeChunk(waId, slots, offset, ctx) {
  const chunk = slots.slice(offset, offset + 10);
  const rows = chunk.map((t, i) => ({
    id: `DK_T:${offset + i}`,
    title: t.slice(0, 24),
  }));
  await sendListMessage(
    waId,
    `Available times (${offset + 1}–${offset + chunk.length} of ${slots.length}):`,
    'Pick time',
    rows,
    'Select time'
  );
  if (slots.length > offset + chunk.length) {
    await sendReplyButtons(waId, 'More times?', [
      { id: `DK_TOFF:${offset + chunk.length}`, title: 'More times' },
      { id: 'DK_BKDATE', title: 'Change date' },
      { id: 'D_MENU', title: 'Cancel' },
    ]);
  } else {
    await sendReplyButtons(waId, 'Done?', [
      { id: 'DK_BKDATE', title: 'Change date' },
      { id: 'D_MENU', title: 'Cancel' },
    ]);
  }
  return {
    flow: 'doctor_book',
    step: 'pick_time',
    contextPatch: { ...ctx, availableSlots: slots, timeOffset: offset },
    lastActionId: `DK_TOFF:${offset}`,
  };
}

async function sendUpcomingApptPicker(waId, { prefix, header, flow, buttonLabel }) {
  const list = await listUpcomingConfirmedAppointments(10);
  if (!list.length) {
    await sendText(waId, 'No upcoming confirmed appointments.');
    await doctorMainMenu()(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: `${prefix}_empty` };
  }
  const rows = list.map((a) => ({
    id: `${prefix}_PICK:${a._id}`,
    title: `${shortDateLabel(a.date)} ${a.time}`.slice(0, 24),
    description: `${a.name}`.slice(0, 72),
  }));
  await sendListMessage(waId, header, buttonLabel, rows, 'Appointments');
  return { flow, step: 'pick_appt', resetContext: true, lastActionId: prefix };
}

async function sendDoctorRescheduleDateList(waId, apptId) {
  const dates = getNextBookableDates(10);
  const rows = dates.map((ymd) => ({
    id: `DR_D:${ymd}`,
    title: shortDateLabel(ymd),
    description: ymd,
  }));
  await sendListMessage(
    waId,
    'Pick the new date (IST).',
    'Pick date',
    rows,
    'Reschedule'
  );
  return {
    flow: 'doctor_reschedule',
    step: 'pick_date',
    contextPatch: { rescheduleId: apptId },
    lastActionId: 'DR_start',
  };
}

async function sendDoctorRescheduleTimeChunk(waId, slots, offset, ctx) {
  const chunk = slots.slice(offset, offset + 10);
  const rows = chunk.map((t, i) => ({
    id: `DR_T:${offset + i}`,
    title: t.slice(0, 24),
  }));
  await sendListMessage(
    waId,
    `New time (${offset + 1}–${offset + chunk.length} of ${slots.length}):`,
    'Pick time',
    rows,
    'Select time'
  );
  if (slots.length > offset + chunk.length) {
    await sendReplyButtons(waId, 'More times?', [
      { id: `DR_TOFF:${offset + chunk.length}`, title: 'More times' },
      { id: 'DR_BKDATE', title: 'Change date' },
      { id: 'D_MENU', title: 'Cancel' },
    ]);
  } else {
    await sendReplyButtons(waId, 'Done?', [
      { id: 'DR_BKDATE', title: 'Change date' },
      { id: 'D_MENU', title: 'Cancel' },
    ]);
  }
  return {
    flow: 'doctor_reschedule',
    step: 'pick_time',
    contextPatch: { ...ctx, availableSlots: slots, timeOffset: offset },
    lastActionId: `DR_TOFF:${offset}`,
  };
}

async function startDoctorBook(waId) {
  await sendText(waId, 'Book for patient — step 1 of 3\n\nType the patient\'s full name:');
  return {
    flow: 'doctor_book',
    step: 'enter_name',
    resetContext: true,
    lastActionId: 'D_BOOK',
  };
}

async function handleDoctorBookFlow({ waId, event, ctx, session }) {
  const kind = event.kind;
  const id = kind === 'button' ? event.buttonId : kind === 'list' ? event.rowId : '';
  const step = session?.step || 'enter_name';

  if (kind === 'button' && (id === 'D_MENU' || id === 'DK_CAN')) {
    await doctorMainMenu()(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: id };
  }

  if (kind === 'text' && step === 'enter_name') {
    const name = sanitizePatientName(event.body);
    if (!name) {
      await sendText(waId, 'Please enter a valid name (at least 2 letters).');
      return { flow: 'doctor_book', step: 'enter_name', lastActionId: 'bad_name' };
    }
    await sendText(waId, `Step 2 of 3 — Patient: ${name}\n\nType their phone number (10 digits):`);
    return {
      flow: 'doctor_book',
      step: 'enter_phone',
      contextPatch: { patientName: name },
      lastActionId: 'name_ok',
    };
  }

  if (kind === 'text' && step === 'enter_phone') {
    const phone = parsePhoneFromText(event.body);
    if (!phone) {
      await sendText(waId, 'Invalid phone. Send a 10-digit mobile number, e.g. 9876543210');
      return { flow: 'doctor_book', step: 'enter_phone', contextPatch: ctx, lastActionId: 'bad_phone' };
    }
    await sendDoctorBookDateList(waId);
    return {
      flow: 'doctor_book',
      step: 'pick_date',
      contextPatch: { patientPhone: phone },
      lastActionId: 'phone_ok',
    };
  }

  if (kind === 'list' && id.startsWith('DK_D:')) {
    const date = id.slice(5);
    const slots = await getAvailableSlots(date);
    if (!slots.length) {
      await sendText(waId, 'No free slots that day. Pick another date.');
      await sendDoctorBookDateList(waId);
      return {
        flow: 'doctor_book',
        step: 'pick_date',
        contextPatch: ctx,
        lastActionId: 'no_slots',
      };
    }
    await sendDoctorBookTimeChunk(waId, slots, 0, { ...ctx, bookDate: date });
    return {
      flow: 'doctor_book',
      step: 'pick_time',
      contextPatch: { bookDate: date, availableSlots: slots, timeOffset: 0 },
      lastActionId: date,
    };
  }

  if (kind === 'button' && id === 'DK_BKDATE') {
    await sendDoctorBookDateList(waId);
    return {
      flow: 'doctor_book',
      step: 'pick_date',
      contextPatch: { bookDate: null, availableSlots: null, pendingTime: null, timeOffset: null },
      lastActionId: id,
    };
  }

  if (kind === 'button' && id.startsWith('DK_TOFF:')) {
    const offset = parseInt(id.slice('DK_TOFF:'.length), 10);
    const slots = ctx.availableSlots || [];
    return sendDoctorBookTimeChunk(waId, slots, offset, ctx);
  }

  if (kind === 'list' && id.startsWith('DK_T:')) {
    const idx = parseInt(id.slice(5), 10);
    const time = ctx.availableSlots?.[idx];
    const date = ctx.bookDate;
    const name = ctx.patientName;
    const phone = ctx.patientPhone;
    if (!time || !date || !name || !phone) {
      await doctorMainMenu()(waId);
      return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'book_lost' };
    }
    await sendReplyButtons(
      waId,
      `Confirm booking?\n\n👤 ${name}\n📞 ${phone}\n📅 ${date}\n🕐 ${time}`,
      [
        { id: 'DK_CONFIRM', title: 'Confirm' },
        { id: 'DK_BKDATE', title: 'Change date' },
        { id: 'D_MENU', title: 'Cancel' },
      ]
    );
    return {
      flow: 'doctor_book',
      step: 'confirm',
      contextPatch: { pendingTime: time },
      lastActionId: time,
    };
  }

  if (kind === 'button' && id === 'DK_CONFIRM') {
    const { patientName, patientPhone, bookDate, pendingTime } = ctx;
    if (!patientName || !patientPhone || !bookDate || !pendingTime) {
      await doctorMainMenu()(waId);
      return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'book_expired' };
    }
    try {
      const appt = await createAppointmentByClinic({
        name: patientName,
        phone: patientPhone,
        date: bookDate,
        time: pendingTime,
        notes: 'Booked by doctor via WhatsApp',
      });
      await notifyPatientAppointmentConfirmed(appt);
      await sendText(
        waId,
        `✅ Booked!\n\n${appt.name}\n${appt.date} at ${appt.time}\n\nPatient notified on WhatsApp.`
      );
    } catch (e) {
      const msg =
        e.code === 'CONFLICT' || e.message === 'SLOT_TAKEN'
          ? 'That slot was just taken. Pick another time.'
          : e.message || 'Booking failed.';
      await sendText(waId, msg);
      if (ctx.bookDate) {
        const slots = await getAvailableSlots(ctx.bookDate);
        if (slots.length) {
          return sendDoctorBookTimeChunk(waId, slots, 0, ctx);
        }
      }
      await doctorMainMenu()(waId);
      return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'book_fail' };
    }
    await doctorMainMenu()(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'DK_CONFIRM' };
  }

  if (step === 'enter_name') {
    await sendText(waId, 'Type the patient\'s full name to continue booking.');
    return { flow: 'doctor_book', step: 'enter_name', lastActionId: 'prompt_name' };
  }

  await doctorMainMenu()(waId);
  return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'book_recover' };
}

async function handleDoctorCancelFlow({ waId, event, ctx }) {
  const kind = event.kind;
  const id = kind === 'button' ? event.buttonId : kind === 'list' ? event.rowId : '';

  if (kind === 'button' && (id === 'D_MENU' || id === 'DC_NO')) {
    await doctorMainMenu()(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: id };
  }

  if (kind === 'list' && id.startsWith('DC_PICK:')) {
    const apptId = id.slice(8);
    const appt = await Appointment.findById(apptId).lean();
    if (!appt || appt.status !== 'confirmed') {
      await sendText(waId, 'That appointment is no longer available.');
      return sendUpcomingApptPicker(waId, {
        prefix: 'DC',
        header: 'Pick an appointment to cancel:',
        flow: 'doctor_cancel',
        buttonLabel: 'Pick visit',
      });
    }
    await sendReplyButtons(
      waId,
      `Cancel this visit?\n\n👤 ${appt.name}\n📅 ${appt.date}\n🕐 ${appt.time}`,
      [
        { id: `DC_YES:${apptId}`, title: 'Yes, cancel' },
        { id: 'DC_NO', title: 'No' },
        { id: 'D_MENU', title: 'Menu' },
      ]
    );
    return {
      flow: 'doctor_cancel',
      step: 'confirm',
      contextPatch: { cancelId: apptId },
      lastActionId: apptId,
    };
  }

  if (kind === 'button' && id.startsWith('DC_YES:')) {
    const apptId = id.slice(7);
    const result = await cancelAppointmentByClinic(apptId);
    if (!result.ok) {
      await sendText(waId, 'Could not cancel that appointment.');
    } else {
      await sendText(
        waId,
        `✅ Cancelled: ${result.appt.name} — ${result.appt.date} ${result.appt.time}\n\nPatient notified on WhatsApp.`
      );
    }
    await doctorMainMenu()(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'DC_YES' };
  }

  return sendUpcomingApptPicker(waId, {
    prefix: 'DC',
    header: 'Pick an appointment to cancel:',
    flow: 'doctor_cancel',
    buttonLabel: 'Pick visit',
  });
}

async function handleDoctorRescheduleFlow({ waId, event, ctx }) {
  const kind = event.kind;
  const id = kind === 'button' ? event.buttonId : kind === 'list' ? event.rowId : '';

  if (kind === 'button' && (id === 'D_MENU' || id === 'DR_CAN')) {
    await doctorMainMenu()(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: id };
  }

  if (kind === 'list' && id.startsWith('DR_PICK:')) {
    const apptId = id.slice(8);
    const appt = await Appointment.findById(apptId).lean();
    if (!appt || appt.status !== 'confirmed') {
      await sendText(waId, 'That appointment is no longer available.');
      return sendUpcomingApptPicker(waId, {
        prefix: 'DR',
        header: 'Pick an appointment to reschedule:',
        flow: 'doctor_reschedule',
        buttonLabel: 'Pick visit',
      });
    }
    await sendText(waId, `Rescheduling ${appt.name} (was ${appt.date} ${appt.time})`);
    return sendDoctorRescheduleDateList(waId, apptId);
  }

  if (kind === 'list' && id.startsWith('DR_D:')) {
    const date = id.slice(5);
    const apptId = ctx.rescheduleId;
    if (!apptId) {
      await doctorMainMenu()(waId);
      return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'rsv_lost' };
    }
    const slots = await getAvailableSlotsForReschedule(date, apptId);
    if (!slots.length) {
      await sendText(waId, 'No free slots that day. Pick another date.');
      return sendDoctorRescheduleDateList(waId, apptId);
    }
    await sendDoctorRescheduleTimeChunk(waId, slots, 0, { ...ctx, bookDate: date, availableSlots: slots });
    return {
      flow: 'doctor_reschedule',
      step: 'pick_time',
      contextPatch: { bookDate: date, availableSlots: slots, timeOffset: 0 },
      lastActionId: date,
    };
  }

  if (kind === 'button' && id === 'DR_BKDATE') {
    const apptId = ctx.rescheduleId;
    if (!apptId) {
      await doctorMainMenu()(waId);
      return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'rsv_lost' };
    }
    return sendDoctorRescheduleDateList(waId, apptId);
  }

  if (kind === 'button' && id.startsWith('DR_TOFF:')) {
    const offset = parseInt(id.slice('DR_TOFF:'.length), 10);
    return sendDoctorRescheduleTimeChunk(waId, ctx.availableSlots || [], offset, ctx);
  }

  if (kind === 'list' && id.startsWith('DR_T:')) {
    const idx = parseInt(id.slice(5), 10);
    const time = ctx.availableSlots?.[idx];
    const date = ctx.bookDate;
    const apptId = ctx.rescheduleId;
    if (!time || !date || !apptId) {
      await doctorMainMenu()(waId);
      return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'rsv_bad' };
    }
    const appt = await Appointment.findById(apptId).lean();
    await sendReplyButtons(
      waId,
      `Confirm reschedule?\n\n👤 ${appt?.name || 'Patient'}\n📅 ${date}\n🕐 ${time}`,
      [
        { id: 'DR_CONFIRM', title: 'Confirm' },
        { id: 'DR_BKDATE', title: 'Change date' },
        { id: 'D_MENU', title: 'Cancel' },
      ]
    );
    return {
      flow: 'doctor_reschedule',
      step: 'confirm',
      contextPatch: { pendingTime: time },
      lastActionId: time,
    };
  }

  if (kind === 'button' && id === 'DR_CONFIRM') {
    const { rescheduleId, bookDate, pendingTime } = ctx;
    if (!rescheduleId || !bookDate || !pendingTime) {
      await doctorMainMenu()(waId);
      return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'rsv_expired' };
    }
    try {
      const appt = await rescheduleAppointmentByClinic(rescheduleId, bookDate, pendingTime);
      await sendText(
        waId,
        `✅ Rescheduled to ${appt.date} at ${appt.time}\n\nPatient notified on WhatsApp.`
      );
    } catch (e) {
      const msg =
        e.code === 'CONFLICT' || e.message === 'SLOT_TAKEN'
          ? 'That slot was just taken. Pick another time.'
          : e.message || 'Reschedule failed.';
      await sendText(waId, msg);
      const slots = await getAvailableSlotsForReschedule(bookDate, rescheduleId);
      if (slots.length) {
        return sendDoctorRescheduleTimeChunk(waId, slots, 0, ctx);
      }
      await doctorMainMenu()(waId);
      return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'rsv_fail' };
    }
    await doctorMainMenu()(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'DR_CONFIRM' };
  }

  return sendUpcomingApptPicker(waId, {
    prefix: 'DR',
    header: 'Pick an appointment to reschedule:',
    flow: 'doctor_reschedule',
    buttonLabel: 'Pick visit',
  });
}

module.exports = {
  startDoctorBook,
  handleDoctorBookFlow,
  handleDoctorCancelFlow,
  handleDoctorRescheduleFlow,
  sendUpcomingApptPicker,
};
