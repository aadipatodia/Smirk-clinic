const { sendText } = require('./outbound');

/** Words/phrases that cancel the current flow and open the doctor main menu. */
const DOCTOR_MENU_ESCAPE_EXACT = new Set([
  'menu',
  'main menu',
  'main',
  'quit',
  'abort',
  'reset',
  'back to menu',
  'mainmenu',
]);

function isDoctorMenuEscape(text) {
  const t = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return DOCTOR_MENU_ESCAPE_EXACT.has(t);
}

function doctorMenuEscapeHint() {
  return 'Tip: type menu, cancel, or stop anytime to return to the main menu.';
}

async function returnDoctorToMainMenu(waId) {
  const { sendDoctorMainMenu } = require('./flows/doctorFlow');
  await sendText(waId, '↩️ Back to main menu.');
  await sendDoctorMainMenu(waId);
  return { flow: 'idle', step: '0', resetContext: true, lastActionId: 'menu_escape' };
}

module.exports = {
  isDoctorMenuEscape,
  doctorMenuEscapeHint,
  returnDoctorToMainMenu,
  DOCTOR_MENU_ESCAPE_EXACT,
};
