const WaProcessedMessage = require('../../models/WaProcessedMessage');
const { normalizeWaId } = require('./normalizeWaId');
const { resolveRole } = require('./roleResolver');
const { getSession, touchSession } = require('./sessionStore');
const {
  normalizeInboundMessage,
  collectInboundMessages,
  describeInboundEvent,
} = require('./inboundNormalize');
const { logUserMessage, rememberBotNumber } = require('./waLog');
const { handlePatientAction } = require('./flows/patientFlow');
const { handleDoctorAction } = require('./flows/doctorFlow');

function mergeContext(session, flowResult) {
  const prev =
    session?.context && typeof session.context === 'object' ? { ...session.context } : {};
  if (flowResult.resetContext) {
    return { ...(flowResult.contextPatch || {}) };
  }
  if (flowResult.contextPatch) {
    return { ...prev, ...flowResult.contextPatch };
  }
  return prev;
}

/**
 * @param {object} body parsed JSON webhook body
 */
async function processWebhookBody(body) {
  const items = collectInboundMessages(body);

  if (!items.length) return;

  for (const item of items) {
    if (item.type === 'status') continue;

    if (item.type !== 'message') continue;

    const message = item.message;
    const messageId = message?.id;
    const from = message?.from;
    if (!messageId || !from) continue;

    const waId = normalizeWaId(from);
    let recorded = false;

    try {
      try {
        await WaProcessedMessage.create({ messageId, waId });
        recorded = true;
      } catch (e) {
        if (e.code === 11000) continue;
        throw e;
      }

      const role = await resolveRole(waId);
      const session = await getSession(waId);
      const event = normalizeInboundMessage(message);
      rememberBotNumber(item.metadata);
      logUserMessage(waId, describeInboundEvent(event), role);

      const flowResult =
        role === 'doctor'
          ? await handleDoctorAction({ waId, event, session })
          : await handlePatientAction({ waId, event, session });

      const nextContext = mergeContext(session, flowResult);

      await touchSession(waId, {
        role,
        flow: flowResult.flow != null ? flowResult.flow : session?.flow || 'idle',
        step: flowResult.step != null ? flowResult.step : session?.step || '0',
        lastActionId: flowResult.lastActionId != null ? flowResult.lastActionId : messageId,
        context: nextContext,
      });
    } catch (err) {
      console.error('flowEngine error:', err.message || err);
      if (recorded) {
        await WaProcessedMessage.deleteOne({ messageId }).catch(() => {});
      }
      throw err;
    }
  }
}

module.exports = {
  processWebhookBody,
};
