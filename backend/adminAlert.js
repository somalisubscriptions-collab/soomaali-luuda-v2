/**
 * adminAlert.js
 * Lightweight Telegram alert sender - no bot instance needed.
 * Uses direct HTTP POST to Telegram API so it works anywhere.
 */
const https = require('https');

const BOT_TOKEN = '6029379159:AAFlQDHODbeCMepl5_Q_Xp26Uv0aCQkwG2o';
const ADMIN_CHAT_ID = '6065559126';

/**
 * Send a Markdown message to the admin via Telegram.
 * @param {string} message - The message text (supports Markdown)
 */
const sendAdminAlert = (message) => {
    try {
        const body = JSON.stringify({
            chat_id: ADMIN_CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });

        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${BOT_TOKEN}/sendMessage`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                const parsed = JSON.parse(data);
                if (parsed.ok) {
                    console.log('✅ Admin Alert sent!');
                } else {
                    console.error('❌ Telegram API error:', parsed.description);
                }
            });
        });

        req.on('error', (err) => {
            console.error('❌ Admin Alert network error:', err.message);
        });

        req.write(body);
        req.end();

    } catch (err) {
        console.error('❌ sendAdminAlert failed:', err.message);
    }
};

module.exports = { sendAdminAlert };
