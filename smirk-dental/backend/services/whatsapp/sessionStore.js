const WaConversationSession = require('../../models/WaConversationSession');

async function getSession(waId) {
  return WaConversationSession.findOne({ waId }).lean();
}

async function touchSession(waId, patch) {
  const allowed = {};
  if (patch.role) allowed.role = patch.role;
  if (patch.flow != null) allowed.flow = patch.flow;
  if (patch.step != null) allowed.step = patch.step;
  if (patch.context != null) allowed.context = patch.context;
  if (patch.lastActionId != null) allowed.lastActionId = patch.lastActionId;

  return WaConversationSession.findOneAndUpdate(
    { waId },
    { $set: { waId, ...allowed } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

module.exports = { getSession, touchSession };
