const outbound = require('./whatsapp/outbound');

module.exports = {
  sendWhatsAppMessage: outbound.sendWhatsAppMessage,
  sendText: outbound.sendText,
  sendReplyButtons: outbound.sendReplyButtons,
  sendListMessage: outbound.sendListMessage,
  sendTemplate: outbound.sendTemplate,
};
