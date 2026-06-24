const Appointment = require('../../../models/Appointment');
const Unavailable = require('../../../models/Unavailable');
const {
  VALID_SLOTS,
  getNextBookableDates,
  setAppointmentStatus,
  futureSlotsForDate,
} = require('../../appointmentService');
const { sendReplyButtons, sendText, sendListMessage } = require('../outbound');
const { todayYmdIst, addDaysYmdIst } = require('../dateIst');
const { sendReviewPromptToPatient } = require('../reviewPrompt');
const {
  startDoctorBook,
  handleDoctorBookFlow,
  handleDoctorCancelFlow,
  handleDoctorRescheduleFlow,
  sendUpcomingApptPicker,
} = require('./doctorApptFlow');

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
      { id: 'D_BOOK', title: 'Book for patient', description: 'Phone / walk-in booking' },
      { id: 'D_CNCL', title: 'Cancel appointment', description: 'Cancel a patient visit' },
      { id: 'D_RSV', title: 'Reschedule visit', description: 'Move a patient slot' },
      { id: 'D_MGR', title: 'Mark complete', description: 'Complete / no-show' },
      { id: 'D_BLK', title: 'Block availability', description: 'Day or single slot' },
      { id: 'D_UBK', title: 'Unblock availability', description: 'Open day or slot' },
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

async function getDatesWithBlocks(limit = 10) {
  const today = todayYmdIst();
  if (!today) return [];
  const rows = await Unavailable.find({ date: { $gte: today } })
    .sort({ date: 1, time: 1 })
    .lean();
  const byDate = new Map();
  for (const row of rows) {
    if (!byDate.has(row.date)) {
      byDate.set(row.date, { fullDay: false, slots: new Set() });
    }
    const state = byDate.get(row.date);
    if (!row.time) state.fullDay = true;
    else state.slots.add(row.time);
  }
  const dates = [];
  for (const date of [...byDate.keys()].sort()) {
    const state = byDate.get(date);
    if (dateHasUnblockableBlocks(date, state)) {
      dates.push(date);
      if (dates.length >= limit) break;
    }
  }
  return dates;
}

function sortSlotsByClinicOrder(slots) {
  const order = new Map(VALID_SLOTS.map((t, i) => [t, i]));
  return [...slots].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
}

function futureBlockedSlots(date, slots) {
  const future = new Set(futureSlotsForDate(date));
  return sortSlotsByClinicOrder([...new Set(slots)].filter((t) => future.has(t)));
}

function dateHasUnblockableBlocks(date, { fullDay, slots }) {
  const future = futureSlotsForDate(date);
  if (!future.length) return false;
  if (fullDay) return true;
  const slotList = slots instanceof Set ? [...slots] : slots;
  return slotList.some((t) => future.includes(t));
}

async function getBlockedStateForDate(date) {
  const rows = await Unavailable.find({ date }).lean();
  let fullDay = false;
  const slots = [];
  rows.forEach((row) => {
    if (!row.time) fullDay = true;
    else slots.push(row.time);
  });
  return { fullDay, slots: sortSlotsByClinicOrder([...new Set(slots)]) };
}

async function sendUnblockDateList(waId) {
  const dates = await getDatesWithBlocks(10);
  if (!dates.length) {
    await sendText(waId, 'No blocked dates with bookable slots left.');
    await sendDoctorMainMenu(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'D_UBK_empty' };
  }
  const rows = dates.map((ymd) => ({
    id: `DU_D:${ymd}`,
    title: ymd.slice(5).replace('-', '/'),
    description: ymd,
  }));
  await sendListMessage(
    waId,
    'Choose a date to unblock (IST).',
    'Pick date',
    rows,
    'Unblock'
  );
  return {
    flow: 'doctor_unblock',
    step: 'pick_unblock_date',
    resetContext: true,
    lastActionId: 'D_UBK',
  };
}

async function sendUnblockSlotPage(waId, date, blockedSlots, start) {
  const relevant = futureBlockedSlots(date, blockedSlots);
  if (!relevant.length) {
    await sendText(waId, 'No blocked slots left to open on that date.');
    return sendUnblockDateList(waId);
  }
  const chunk = relevant.slice(start, start + 10);
  const rows = chunk.map((t) => ({
    id: `DU_T:${encodeURIComponent(t)}`,
    title: t.slice(0, 24),
  }));
  await sendListMessage(
    waId,
    `Blocked slots on ${date} (page ${Math.floor(start / 10) + 1}). Tap one to open it.`,
    'Pick slot',
    rows,
    'Unblock'
  );
  if (start + 10 < relevant.length) {
    await sendReplyButtons(waId, 'Navigate', [
      { id: `DU_TPAGE:${start + 10}`, title: 'More slots' },
      { id: `DU_TPAGE:${Math.max(0, start - 10)}`, title: 'Prev slots' },
      { id: 'DU_CAN', title: 'Cancel' },
    ]);
  } else if (start > 0) {
    await sendReplyButtons(waId, 'Done?', [
      { id: `DU_TPAGE:${Math.max(0, start - 10)}`, title: 'Prev slots' },
      { id: 'DU_CAN', title: 'Cancel' },
      { id: 'D_MENU', title: 'Main menu' },
    ]);
  } else {
    await sendReplyButtons(waId, 'Done?', [
      { id: 'DU_CAN', title: 'Cancel' },
      { id: 'D_MENU', title: 'Main menu' },
    ]);
  }
  return {
    flow: 'doctor_unblock',
    step: 'pick_unblock_slot',
    contextPatch: { unblockDate: date, slotPage: start },
    lastActionId: `DU_TPAGE:${start}`,
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
    const blockableSlots = futureSlotsForDate(date);
    if (!blockableSlots.length) {
      await sendText(waId, 'No slots left to block on that date. Pick another day.');
      return sendBlockDateList(waId);
    }
    const rows = blockableSlots.slice(0, 10).map((t) => ({
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
    if (blockableSlots.length > 10) {
      await sendReplyButtons(waId, 'More slots on next page?', [
        { id: 'DB_TPAGE:10', title: 'More slots' },
        { id: 'DB_CAN', title: 'Cancel' },
        { id: 'D_MENU', title: 'Main menu' },
      ]);
    } else {
      await sendReplyButtons(waId, 'Done?', [
        { id: 'DB_CAN', title: 'Cancel' },
        { id: 'D_MENU', title: 'Main menu' },
      ]);
    }
    return {
      flow: 'doctor_block',
      step: 'pick_slot',
      contextPatch: { blockDate: date, slotPage: 0 },
      lastActionId: 'DB_SLOT',
    };
  }

  if (kind === 'button' && id.startsWith('DB_TPAGE:')) {
    const start = parseInt(id.slice('DB_TPAGE:'.length), 10);
    const date = ctx.blockDate;
    if (!date) {
      await sendDoctorMainMenu(waId);
      return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'blk_bad' };
    }
    const blockableSlots = futureSlotsForDate(date);
    const chunk = blockableSlots.slice(start, start + 10);
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
      `Slots for ${date} (page ${Math.floor(start / 10) + 1})`,
      'Pick slot',
      rows,
      'Slot'
    );
    if (start + 10 < blockableSlots.length) {
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

async function handleDoctorUnblockFlow({ waId, event, ctx }) {
  const kind = event.kind;
  const id = kind === 'button' ? event.buttonId : kind === 'list' ? event.rowId : '';

  if (kind === 'button' && (id === 'D_MENU' || id === 'DU_CAN')) {
    await sendDoctorMainMenu(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: id };
  }

  if (kind === 'list' && id.startsWith('DU_D:')) {
    const date = id.slice(5);
    const state = await getBlockedStateForDate(date);
    const { fullDay, slots } = state;
    if (!dateHasUnblockableBlocks(date, state)) {
      await sendText(waId, 'No bookable slots left on that date.');
      return sendUnblockDateList(waId);
    }
    if (fullDay) {
      await sendReplyButtons(
        waId,
        `${date} is fully blocked.\n\nUnblock the entire day?`,
        [
          { id: 'DU_ALL', title: 'Unblock full day' },
          { id: 'DU_CAN', title: 'Cancel' },
        ]
      );
      return {
        flow: 'doctor_unblock',
        step: 'unblock_kind',
        contextPatch: { unblockDate: date, fullDayBlock: true },
        lastActionId: date,
      };
    }
    return sendUnblockSlotPage(waId, date, slots, 0);
  }

  if (kind === 'button' && id === 'DU_ALL') {
    const date = ctx.unblockDate;
    if (!date) {
      await sendDoctorMainMenu(waId);
      return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'ubk_bad' };
    }
    const result = await Unavailable.deleteMany({
      date,
      $or: [{ time: null }, { time: { $exists: false } }],
    });
    if (!result.deletedCount) {
      await sendText(waId, 'No full-day block found on that date.');
    } else {
      await sendText(waId, `✅ Full day unblocked: ${date}`);
    }
    await sendDoctorMainMenu(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'DU_ALL' };
  }

  if (kind === 'button' && id === 'DU_SLOT') {
    const date = ctx.unblockDate;
    if (!date) {
      await sendDoctorMainMenu(waId);
      return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'ubk_bad' };
    }
    const { fullDay, slots } = await getBlockedStateForDate(date);
    if (fullDay) {
      await sendText(waId, 'That day is fully blocked. Unblock the full day first.');
      await sendReplyButtons(waId, `${date} is fully blocked.`, [
        { id: 'DU_ALL', title: 'Unblock full day' },
        { id: 'DU_CAN', title: 'Cancel' },
      ]);
      return {
        flow: 'doctor_unblock',
        step: 'unblock_kind',
        contextPatch: { unblockDate: date, fullDayBlock: true },
        lastActionId: 'DU_SLOT_full',
      };
    }
    if (!slots.length) {
      await sendText(waId, 'No blocked slots on that date.');
      return sendUnblockDateList(waId);
    }
    const openable = futureBlockedSlots(date, slots);
    if (!openable.length) {
      await sendText(waId, 'No blocked slots left to open on that date.');
      return sendUnblockDateList(waId);
    }
    return sendUnblockSlotPage(waId, date, slots, 0);
  }

  if (kind === 'button' && id.startsWith('DU_TPAGE:')) {
    const start = parseInt(id.slice('DU_TPAGE:'.length), 10);
    const date = ctx.unblockDate;
    if (!date) {
      await sendDoctorMainMenu(waId);
      return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'ubk_bad' };
    }
    const { slots } = await getBlockedStateForDate(date);
    const openable = futureBlockedSlots(date, slots);
    if (!openable.length) {
      await sendText(waId, 'No blocked slots left on that date.');
      return sendUnblockDateList(waId);
    }
    return sendUnblockSlotPage(waId, date, slots, start);
  }

  if (kind === 'list' && id.startsWith('DU_T:')) {
    const time = decodeURIComponent(id.slice(5));
    const date = ctx.unblockDate;
    if (!date || !VALID_SLOTS.includes(time)) {
      await sendDoctorMainMenu(waId);
      return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'ubk_bad' };
    }
    if (!futureSlotsForDate(date).includes(time)) {
      await sendText(waId, 'That slot time has already passed.');
      return sendUnblockDateList(waId);
    }
    const result = await Unavailable.deleteMany({ date, time });
    if (!result.deletedCount) {
      await sendText(waId, 'That slot was not blocked.');
    } else {
      await sendText(waId, `✅ Unblocked ${time} on ${date}`);
    }
    await sendDoctorMainMenu(waId);
    return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'DU_T' };
  }

  await sendDoctorMainMenu(waId);
  return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'ubk_recover' };
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
  if (flow === 'doctor_unblock') {
    return handleDoctorUnblockFlow({ waId, event, ctx });
  }
  if (flow === 'doctor_manage') {
    return handleDoctorManageFlow({ waId, event, ctx });
  }
  if (flow === 'doctor_book') {
    return handleDoctorBookFlow({ waId, event, ctx, session });
  }
  if (flow === 'doctor_cancel') {
    return handleDoctorCancelFlow({ waId, event, ctx });
  }
  if (flow === 'doctor_reschedule') {
    return handleDoctorRescheduleFlow({ waId, event, ctx });
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
      case 'D_BOOK':
        return await startDoctorBook(waId);
      case 'D_CNCL':
        return sendUpcomingApptPicker(waId, {
          prefix: 'DC',
          header: 'Pick an appointment to cancel:',
          flow: 'doctor_cancel',
          buttonLabel: 'Pick visit',
        });
      case 'D_RSV':
        return sendUpcomingApptPicker(waId, {
          prefix: 'DR',
          header: 'Pick an appointment to reschedule:',
          flow: 'doctor_reschedule',
          buttonLabel: 'Pick visit',
        });
      case 'D_BLK':
        return await sendBlockDateList(waId);
      case 'D_UBK':
        return await sendUnblockDateList(waId);
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
  if (id?.startsWith('DU_D:') || id?.startsWith('DU_T:') || id?.startsWith('DU_')) {
    return handleDoctorUnblockFlow({ waId, event, ctx });
  }
  if (id?.startsWith('D_PICK:') || id?.startsWith('D_DONE:') || id?.startsWith('D_NS:')) {
    return handleDoctorManageFlow({ waId, event, ctx });
  }
  if (id?.startsWith('DK_') || id === 'DK_CONFIRM') {
    return handleDoctorBookFlow({ waId, event, ctx, session });
  }
  if (id?.startsWith('DC_')) {
    return handleDoctorCancelFlow({ waId, event, ctx });
  }
  if (id?.startsWith('DR_')) {
    return handleDoctorRescheduleFlow({ waId, event, ctx });
  }

  await sendDoctorMainMenu(waId);
  return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'unknown' };
}

async function handleDoctorAction({ waId, event, session }) {
  const ctx = session?.context && typeof session.context === 'object' ? session.context : {};
  const flow = session?.flow || 'idle';

  if (event.kind === 'text') {
    if (flow === 'doctor_book') {
      return handleDoctorBookFlow({ waId, event, ctx, session });
    }
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
