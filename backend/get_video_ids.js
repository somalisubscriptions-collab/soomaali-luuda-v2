// Run this script ONCE to get your video file_ids
// 1. Run: node get_video_ids.js
// 2. Send each tutorial video to your bot in Telegram
// 3. Copy the file_id that appears in your terminal
// 4. Paste each file_id into telegramBot.js

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = '6029379159:AAFlQDHODbeCMepl5_Q_Xp26Uv0aCQkwG2o';
const bot = new TelegramBot(token, { polling: true });

console.log("✅ Bot is listening for videos...");
console.log("📹 Now send each tutorial video directly to your bot in Telegram.");
console.log("The file_id will appear here in the terminal.\n");

bot.on('video', (msg) => {
    const fileId = msg.video.file_id;
    const fileName = msg.video.file_name || 'unknown';
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`📹 Video received: ${fileName}`);
    console.log(`✅ file_id: ${fileId}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    
    bot.sendMessage(msg.chat.id, `✅ Got it! Your file_id is:\n\`${fileId}\``, { parse_mode: 'Markdown' });
});
