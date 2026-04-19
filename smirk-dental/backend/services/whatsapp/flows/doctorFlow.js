const Appointment = require('../../../models/Appointment');
const Unavailable = require('../../../models/Unavailable');
const { VALID_SLOTS, getNextBookableDates, setAppointmentStatus } = require('../../appointmentService');
const { sendReplyButtons, sendText, sendListMessage } = require('../outbound');
const { todayYmdIst, addDaysYmdIst } = require('../dateIst');
const { sendReviewPromptToPatient } = require('../reviewPrompt');

function doctorMenuBody() {
  const name = process.env.CLINIC_NAME || 'Smirk Dental';
  return `👩‍⚕️ Doctor — ${name}\n\nSelect an action:`;
}

async function sendDoctorMainMenu(to) {
  await sendListMessage(
    to,
    doctorMenuBody(),
    'Open menu',
    [
      { id: 'D_SUM', title: "Today's schedule", description: 'List confirmed visits' },
      { id: 'D_TOM', title: 'Tomorrow schedule', description: 'Confirmed visits' },
      { id: 'D_MGR', title: 'Update visit status', description: 'Complete / no-show' },
      { id: 'D_BLK', title: 'Block availability', description: 'Day or single slot' },
      { id: 'D_MENU', title: 'Refresh this menu', description: 'Show options again' },
    ],
    'Doctor'
  );
}

async function buildTodayAppointmentsMessage() {
  const date = todayYmdIst();
  if (!date) {
    return 'Could not resolve today’s date. Please try again.';
  }
  const list = await Appointment.find({
    date,
    status: { $in: ['confirmed'] },
  })
    .sort({ time: 1 })
    .lean();

  if (!list.length) {
    return `📅 ${date} (IST)\n\nNo confirmed appointments for today.`;
  }
  let msg = `📅 Today (${date} IST)\n\n`;
  list.forEach((a, i) => {
    msg += `${i + 1}. ${a.time} — ${a.name} (${a.phone})\n`;
  });
  msg += `\nTotal: ${list.length}`;
  return msg.slice(0, 4000);
}

async function buildTomorrowAppointmentsMessage() {
  const today = todayYmdIst();
  if (!today) return 'Could not resolve tomorrow’s date.';
  const date = addDaysYmdIst(today, 1);
  if (!date) return 'Could not resolve tomorrow’s date.';
  const list = await Appointment.find({
    date,
    status: { $in: ['confirmed'] },
  })
    .sort({ time: 1 })
    .lean();

  if (!list.length) {
    return `📅 ${date} (IST)\n\nNo confirmed appointments for tomorrow.`;
  }
  let msg = `📅 Tomorrow (${date} IST)\n\n`;
  list.forEach((a, i) => {
    msg += `${i + 1}. ${a.time} — ${a.name} (${a.phone})\n`;
  });
  msg += `\nTotal: ${list.length}`;
  return msg.slice(0, 4000);
}

async function sendTodayManageList(waId) {
  const date = todayYmdIst();
  const list = await Appointment.find({
    date,
    status: 'confirmed',
  })
    .sort({ time: 1 })
    .limit(10)
    .lean();

  if (!list.length) {
    await sendText(waId, 'No confirmed visits to update today.');
    await sendDoctorMainMenu(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'D_MGR_empty' };
  }

  const rows = list.map((a) => ({
    id: `D_PICK:${a._id}`,
    title: `${a.time}`.slice(0, 24),
    description: `${a.name}`.slice(0, 72),
  }));

  await sendListMessage(
    waId,
    'Pick a patient visit to update:',
    'Pick visit',
    rows,
    'Visits'
  );
  return {
    flow: 'doctor_manage',
    step: 'pick_appt',
    contextPatch: { manageDate: date },
    lastActionId: 'D_MGR',
  };
}

async function sendBlockDateList(waId) {
  const dates = getNextBookableDates(10);
  const rows = dates.map((ymd) => ({
    id: `DB_D:${ymd}`,
    title: ymd.slice(5).replace('-', '/'),
    description: ymd,
  }));
  await sendListMessage(
    waId,
    'Choose a date to block (IST).',
    'Pick date',
    rows,
    'Block'
  );
  return {
    flow: 'doctor_block',
    step: 'pick_block_date',
    resetContext: true,
    lastActionId: 'D_BLK',
  };
}

async function handleDoctorBlockFlow({ waId, event, ctx }) {
  const kind = event.kind;
  const id = kind === 'button' ? event.buttonId : kind === 'list' ? event.rowId : '';

  if (kind === 'button' && (id === 'D_MENU' || id === 'DB_CAN')) {
    await sendDoctorMainMenu(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: id };
  }

  if (kind === 'list' && id.startsWith('DB_D:')) {
    const date = id.slice(5);
    await sendReplyButtons(
      waId,
      `Block on ${date}:\n\nFull day or one slot?`,
      [
        { id: 'DB_ALL', title: 'Full day' },
        { id: 'DB_SLOT', title: 'One slot' },
        { id: 'DB_CAN', title: 'Cancel' },
      ]
    );
    return {
      flow: 'doctor_block',
      step: 'block_kind',
      contextPatch: { blockDate: date },
      lastActionId: date,
    };
  }

  if (kind === 'button' && id === 'DB_ALL') {
    const date = ctx.blockDate;
    if (!date) {
      await sendDoctorMainMenu(waId);
      return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'blk_bad' };
    }
    try {
      await Unavailable.create({ date, time: null });
    } catch (e) {
      if (e.code !== 11000) throw e;
    }
    await sendText(waId, `✅ Marked entire day unavailable: ${date}`);
    await sendDoctorMainMenu(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'DB_ALL' };
  }

  if (kind === 'button' && id === 'DB_SLOT') {
    const date = ctx.blockDate;
    if (!date) {
      await sendDoctorMainMenu(waId);
      return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'blk_bad' };
    }
    const rows = VALID_SLOTS.slice(0, 10).map((t) => ({
      id: `DB_T:${encodeURIComponent(t)}`,
      title: t.slice(0, 24),
    }));
    await sendListMessage(
      waId,
      `Pick a slot to block on ${date} (page 1).`,
      'Pick slot',
      rows,
      'Slot'
    );
    await sendReplyButtons(waId, 'More slots on next page?', [
      { id: 'DB_TPAGE:10', title: 'More slots' },
      { id: 'DB_CAN', title: 'Cancel' },
      { id: 'D_MENU', title: 'Main menu' },
    ]);
    return {
      flow: 'doctor_block',
      step: 'pick_slot',
      contextPatch: { blockDate: date, slotPage: 0 },
      lastActionId: 'DB_SLOT',
    };
  }

  if (kind === 'button' && id.startsWith('DB_TPAGE:')) {
    const start = parseInt(id.slice(10), 10);
    const date = ctx.blockDate;
    if (!date) {
      await sendDoctorMainMenu(waId);
      return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'blk_bad' };
    }
    const chunk = VALID_SLOTS.slice(start, start + 10);
    if (!chunk.length) {
      await sendText(waId, 'No more slots in this page.');
      await sendDoctorMainMenu(waId);
      return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'blk_page' };
    }
    const rows = chunk.map((t) => ({
      id: `DB_T:${encodeURIComponent(t)}`,
      title: t.slice(0, 24),
    }));
    await sendListMessage(
      waId,
      `Slots for ${date} (offset ${start})`,
      'Pick slot',
      rows,
      'Slot'
    );
    if (start + 10 < VALID_SLOTS.length) {
      await sendReplyButtons(waId, 'Navigate', [
        { id: `DB_TPAGE:${start + 10}`, title: 'More slots' },
        { id: `DB_TPAGE:${Math.max(0, start - 10)}`, title: 'Prev slots' },
        { id: 'DB_CAN', title: 'Cancel' },
      ]);
    } else {
      await sendReplyButtons(waId, 'Done?', [
        { id: `DB_TPAGE:${Math.max(0, start - 10)}`, title: 'Prev slots' },
        { id: 'DB_CAN', title: 'Cancel' },
        { id: 'D_MENU', title: 'Main menu' },
      ]);
    }
    return {
      flow: 'doctor_block',
      step: 'pick_slot',
      contextPatch: { slotPage: start },
      lastActionId: id,
    };
  }

  if (kind === 'list' && id.startsWith('DB_T:')) {
    const time = decodeURIComponent(id.slice(5));
    const date = ctx.blockDate;
    if (!date || !VALID_SLOTS.includes(time)) {
      await sendDoctorMainMenu(waId);
      return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'blk_bad' };
    }
    try {
      await Unavailable.create({ date, time });
    } catch (e) {
      if (e.code === 11000) {
        await sendText(waId, 'That slot was already blocked.');
        await sendDoctorMainMenu(waId);
        return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'dup_blk' };
      }
      throw e;
    }
    await sendText(waId, `✅ Blocked ${time} on ${date}`);
    await sendDoctorMainMenu(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'DB_T' };
  }

  await sendDoctorMainMenu(waId);
  return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'blk_recover' };
}

async function handleDoctorManageFlow({ waId, event, ctx }) {
  const kind = event.kind;
  const id = kind === 'button' ? event.buttonId : kind === 'list' ? event.rowId : '';

  if (kind === 'button' && (id === 'D_MENU' || id === 'DM_CAN')) {
    await sendDoctorMainMenu(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: id };
  }

  if (kind === 'list' && id.startsWith('D_PICK:')) {
    const apptId = id.slice(7);
    await sendReplyButtons(
      waId,
      'Set status for this visit:',
      [
        { id: `D_DONE:${apptId}`, title: 'Completed' },
        { id: `D_NS:${apptId}`, title: 'No-show' },
        { id: 'DM_CAN', title: 'Cancel' },
      ]
    );
    return {
      flow: 'doctor_manage',
      step: 'set_status',
      contextPatch: { selectedAppt: apptId },
      lastActionId: apptId,
    };
  }

  if (kind === 'button' && id.startsWith('D_DONE:')) {
    const apptId = id.slice(7);
    const appt = await setAppointmentStatus(apptId, 'completed');
    if (!appt) {
      await sendText(waId, 'Could not update that visit.');
    } else {
      await sendText(waId, `Marked completed: ${appt.time} — ${appt.name}`);
      if (!appt.reviewRequestSent && !appt.reviewSubmittedAt) {
        const full = await Appointment.findById(apptId).lean();
        if (full) await sendReviewPromptToPatient(full);
      }
    }
    await sendDoctorMainMenu(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'D_DONE' };
  }

  if (kind === 'button' && id.startsWith('D_NS:')) {
    const apptId = id.slice(5);
    const appt = await setAppointmentStatus(apptId, 'no-show');
    if (!appt) await sendText(waId, 'Could not update that visit.');
    else await sendText(waId, `Marked no-show: ${appt.time} — ${appt.name}`);
    await sendDoctorMainMenu(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'D_NS' };
  }

  await sendTodayManageList(waId);
  return {
    flow: 'doctor_manage',
    step: 'pick_appt',
    lastActionId: 'mgr_recover',
  };
}

async function handleDoctorListOrButton({ waId, event, session }) {
  const ctx = session?.context && typeof session.context === 'object' ? session.context : {};
  const flow = session?.flow || 'idle';
  const kind = event.kind;
  const id = kind === 'button' ? event.buttonId : kind === 'list' ? event.rowId : '';

  if (flow === 'doctor_block') {
    return handleDoctorBlockFlow({ waId, event, ctx });
  }
  if (flow === 'doctor_manage') {
    return handleDoctorManageFlow({ waId, event, ctx });
  }

  if (kind === 'list') {
    switch (id) {
      case 'D_SUM': {
        const body = await buildTodayAppointmentsMessage();
        await sendText(waId, body);
        await sendDoctorMainMenu(waId);
        return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'D_SUM' };
      }
      case 'D_TOM': {
        const body = await buildTomorrowAppointmentsMessage();
        await sendText(waId, body);
        await sendDoctorMainMenu(waId);
        return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'D_TOM' };
      }
      case 'D_MGR':
        return await sendTodayManageList(waId);
      case 'D_BLK':
        return await sendBlockDateList(waId);
      case 'D_MENU':
        await sendDoctorMainMenu(waId);
        return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'D_MENU' };
      default:
        break;
    }
  }

  if (kind === 'button') {
    switch (id) {
      case 'D_MENU':
        await sendDoctorMainMenu(waId);
        return { flow: 'idle', step: '0', resetContext: true, lastActionId: id };
      default:
        break;
    }
  }

  if (id?.startsWith('DB_D:') || id?.startsWith('DB_T:') || id?.startsWith('DB_')) {
    return handleDoctorBlockFlow({ waId, event, ctx });
  }
  if (id?.startsWith('D_PICK:') || id?.startsWith('D_DONE:') || id?.startsWith('D_NS:')) {
    return handleDoctorManageFlow({ waId, event, ctx });
  }

  await sendDoctorMainMenu(waId);
  return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'unknown' };
}

async function handleDoctorAction({ waId, event, session }) {
  if (event.kind === 'text') {
    await sendDoctorMainMenu(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'text_open_menu' };
  }

  if (event.kind === 'list' || event.kind === 'button') {
    return handleDoctorListOrButton({ waId, event, session });
  }

  await sendText(waId, 'Please use the menu to continue.');
  await sendDoctorMainMenu(waId);
  return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'unsupported' };
}

module.exports = {
  sendDoctorMainMenu,
  handleDoctorAction,
};
