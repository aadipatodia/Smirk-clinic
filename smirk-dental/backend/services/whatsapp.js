const axios = require('axios');

const sendWhatsAppMessage = async (to, message) => {
    try {
        const url = `${process.env.WHATSAPP_API_URL}/${process.env.WHATSAPP_PHONE_ID}/messages`;

        await axios.post(
            url,
            {
                messaging_product: "whatsapp",
                to: to.replace(/\D/g, ''),
                type: "text",
                text: { body: message }
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                    "Content-Type": "application/json"
                }
            }
        );

        console.log("✅ WhatsApp sent to", to);

    } catch (err) {
        console.error("❌ WhatsApp error:", err.response?.data || err.message);
    }
};

module.exports = { sendWhatsAppMessage };