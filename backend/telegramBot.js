const TelegramBot = require('node-telegram-bot-api');
const User = require('./models/User'); 
const CashLog = require('./models/CashLog');
const FinancialRequest = require('./models/FinancialRequest');
const Game = require('./models/Game');
const Revenue = require('./models/Revenue');

// Your Telegram Bot Token
const token = '6029379159:AAFlQDHODbeCMepl5_Q_Xp26Uv0aCQkwG2o';
const ADMIN_CHAT_ID = '6065559126'; // Your Admin ID

// Initialize the bot with polling
const bot = new TelegramBot(token, { polling: true });

// Track what the user is currently doing (waiting for their next message)
const userState = {};

// ============================================================
// PLAYER MENU - 4 inline buttons shown on /start
// ============================================================
const playerMenuOptions = {
    reply_markup: {
        inline_keyboard: [
            [{ text: "📝 Sidee laisku diiwaan galiyaa?", callback_data: "info_register" }],
            [{ text: "💰 Sidee lacag loo dhigtaa?", callback_data: "info_deposit" }],
            [{ text: "💸 Sidee lacag loola baxaa?", callback_data: "info_withdraw" }],
            [{ text: "📨 Maamulka ii gudbi", callback_data: "contact_admin" }]
        ]
    }
};

// ============================================================
// ADMIN MENU - inline buttons shown to admin on /start
// ============================================================
const adminInlineOptions = {
    reply_markup: {
        inline_keyboard: [
            [{ text: "📊 Report (Maanta)", callback_data: "cmd_report" }],
            [{ text: "📈 Chart (7 Maalmood)", callback_data: "cmd_chart" }]
        ]
    }
};

// ============================================================
// /start command
// ============================================================
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;

    if (chatId.toString() === ADMIN_CHAT_ID) {
        return bot.sendMessage(
            chatId,
            "👨‍💻 *Welcome Admin!*\n\nWaxaad halkan ka arki doontaa dhamaan fariimaha macmiisha.\nSi aad ugu jawaabto, kaliya 'Reply' dheh fariinta aad rabto.\n\n📌 Riix badhanka hoose si aad xisaabta u aragto:",
            { parse_mode: 'Markdown', ...adminInlineOptions }
        );
    }

    // Show player menu
    bot.sendMessage(
        chatId,
        "👋 *Kusoo dhawoow Somlaaduu Bot!*\n\nFadlan dooro su'aasha aad rabto:",
        { parse_mode: 'Markdown', ...playerMenuOptions }
    );
});

// ============================================================
// ANALYTICS FUNCTIONS (Admin only)
// ============================================================
const generateReport = async (chatId) => {
    bot.sendMessage(chatId, "⏳ Diyaarinta report-ka maanta, fadlan sug...");

    try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const deposits = await FinancialRequest.aggregate([
            { $match: { type: 'DEPOSIT', status: 'APPROVED', timestamp: { $gte: startOfDay } } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const totalDeposits = deposits.length > 0 ? deposits[0].total : 0;

        const withdrawals = await FinancialRequest.aggregate([
            { $match: { type: 'WITHDRAWAL', status: 'APPROVED', timestamp: { $gte: startOfDay } } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const totalWithdrawals = withdrawals.length > 0 ? withdrawals[0].total : 0;

        const firstTimeDepositorsQuery = await FinancialRequest.aggregate([
            { $match: { type: 'DEPOSIT', status: 'APPROVED' } },
            { $group: { _id: '$userId', firstDepositDate: { $min: '$timestamp' } } },
            { $match: { firstDepositDate: { $gte: startOfDay } } },
            { $count: 'count' }
        ]);
        const newDepositorsCount = firstTimeDepositorsQuery.length > 0 ? firstTimeDepositorsQuery[0].count : 0;

        const newUsers = await User.countDocuments({ createdAt: { $gte: startOfDay } });

        const ggrQuery = await Revenue.aggregate([
            { $match: { timestamp: { $gte: startOfDay }, amount: { $gt: 0 } } },
            { $group: { _id: null, totalRevenue: { $sum: '$amount' } } }
        ]);
        const ggr = ggrQuery[0] ? ggrQuery[0].totalRevenue : 0;

        const gemTxQuery = await User.aggregate([
            { $unwind: '$transactions' },
            { $match: {
                'transactions.type': 'gem_purchase',
                $or: [
                    { 'transactions.timestamp': { $gte: startOfDay } },
                    { 'transactions.createdAt': { $gte: startOfDay } }
                ]
            }},
            { $group: { _id: null, totalGems: { $sum: '$transactions.amount' } } }
        ]);
        const gemRevenue = gemTxQuery[0] ? gemTxQuery[0].totalGems * 0.01 : 0;

        const dauQuery = await Game.aggregate([
            { $match: { createdAt: { $gte: startOfDay }, status: { $in: ['ACTIVE', 'COMPLETED'] } } },
            { $unwind: '$players' },
            { $match: { 'players.isAI': false } },
            { $group: { _id: '$players.userId' } },
            { $count: 'total' }
        ]);
        const dau = dauQuery[0] ? dauQuery[0].total : 0;

        const totalGames = await Game.countDocuments({
            createdAt: { $gte: startOfDay },
            status: { $in: ['ACTIVE', 'COMPLETED'] }
        });

        const playableUsersQuery = await User.aggregate([
            { $match: { $or: [{ balance: { $gt: 0 } }, { reservedBalance: { $gt: 0 } }] } },
            { $group: { _id: null, count: { $sum: 1 }, totalBalance: { $sum: { $add: ["$balance", { $ifNull: ["$reservedBalance", 0] }] } } } }
        ]);
        const playableUsers = playableUsersQuery[0] ? playableUsersQuery[0].count : 0;
        const playableBalance = playableUsersQuery[0] ? playableUsersQuery[0].totalBalance : 0;

        const report = `
📊 *Xisaabta Maanta (Full Analytics)*
📅 Taariikhda: ${startOfDay.toLocaleDateString()}

👥 *Dadka & Ciyaaraha*
• Macmiil Cusub: *${newUsers}*
• Dadka Ciyaaray (DAU): *${dau}*
• Ciyaaraha La Ciyaaray: *${totalGames}*
• Dadka Lacagta Ku Jirto: *${playableUsers}* (Wadarta: *$${playableBalance.toFixed(2)}*)

💰 *Dhaqaalaha*
• Lacagta lasoo dhigtay: *$${totalDeposits.toFixed(2)}*
• Lacagta lala baxay: *$${totalWithdrawals.toFixed(2)}*
• First-Time Depositors: *${newDepositorsCount}*

📈 *Faa'idada (Revenue)*
• Macaashka Ciyaaraha (GGR): *$${ggr.toFixed(2)}*
• Faa'idada Gems-ka: *$${gemRevenue.toFixed(2)}*
• Faa'idada Guud (Net Profit): *$${ggr.toFixed(2)}*
• Kaashka Saafiga (Net Cash Flow): *$${(totalDeposits - totalWithdrawals).toFixed(2)}*
        `;

        bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });

    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "❌ Cilad ayaa dhacday, isku day mar kale.");
    }
};

const generateChart = async (chatId) => {
    bot.sendMessage(chatId, "🎨 Sawirida graph-ka, fadlan sug...");

    try {
        const last7Days = new Date();
        last7Days.setDate(last7Days.getDate() - 6);
        last7Days.setHours(0, 0, 0, 0);

        const data = await FinancialRequest.aggregate([
            { $match: { status: 'APPROVED', timestamp: { $gte: last7Days } } },
            { $group: { _id: { date: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } }, type: "$type" }, total: { $sum: "$amount" } } }
        ]);

        const dates = [];
        const depositsMap = {};
        const withdrawalsMap = {};

        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            dates.push(dateStr.slice(5));
            depositsMap[dateStr] = 0;
            withdrawalsMap[dateStr] = 0;
        }

        data.forEach(item => {
            const dateStr = item._id.date;
            if (depositsMap[dateStr] !== undefined) {
                if (item._id.type === 'DEPOSIT') depositsMap[dateStr] = item.total;
                if (item._id.type === 'WITHDRAWAL') withdrawalsMap[dateStr] = item.total;
            }
        });

        const chartConfig = {
            type: 'bar',
            data: {
                labels: dates,
                datasets: [
                    { label: 'Deposits ($)', data: Object.values(depositsMap), backgroundColor: 'rgb(46, 204, 113)' },
                    { label: 'Withdrawals ($)', data: Object.values(withdrawalsMap), backgroundColor: 'rgb(231, 76, 60)' }
                ]
            },
            options: { title: { display: true, text: 'Lacagta la dhigtay vs Lala baxay (7 Maalmood)' } }
        };

        const chartUrl = `https://quickchart.io/chart?width=500&height=300&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
        bot.sendPhoto(chatId, chartUrl, { caption: "📈 Graph-ka dhaqaalaha 7-dii maalmood ee lasoo dhaafay." });

    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "❌ Cilad ayaa dhacday graph-ka, isku day mar kale.");
    }
};

// Admin text commands (backup)
bot.onText(/\/report/, (msg) => {
    if (msg.chat.id.toString() === ADMIN_CHAT_ID) generateReport(msg.chat.id);
});
bot.onText(/\/chart/, (msg) => {
    if (msg.chat.id.toString() === ADMIN_CHAT_ID) generateChart(msg.chat.id);
});

// ============================================================
// CALLBACK QUERY HANDLER (handles ALL inline button clicks)
// ============================================================
bot.on('callback_query', async (query) => {
    console.log("🔘 Button clicked:", query.data, "by:", query.from.id);

    try {
        const chatId = query.message.chat.id;
        const data = query.data;

        // Acknowledge the button press immediately (removes loading spinner)
        await bot.answerCallbackQuery(query.id).catch(e => console.error("answerCallbackQuery error:", e));

        // ---- ADMIN BUTTONS ----
        if (chatId.toString() === ADMIN_CHAT_ID) {
            if (data === 'cmd_report') return generateReport(chatId);
            if (data === 'cmd_chart')  return generateChart(chatId);
            return;
        }

        // ---- PLAYER BUTTONS ----
        const username = query.from.username ? `@${query.from.username}` : query.from.first_name;

        if (data === 'info_register') {
            bot.sendMessage(chatId,
                "📝 *Sidee laisku diiwaan galiyaa?*\n\n" +
                "1️⃣ Fur boggayaga: *somlaanduu.com*\n" +
                "2️⃣ Guji badhanka *'Diiwaangeli'*\n" +
                "3️⃣ Buuxi magacaaga, email, iyo password\n" +
                "4️⃣ Guji *'Abuur Xisaab'* — waa dhamaaday! ✅\n\n" +
                "Hadii aad wax kale u baahantahay, nala soo xiriir.",
                { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: "⬅️ Ku noqo", callback_data: "back_menu" }]] } }
            );

        } else if (data === 'info_deposit') {
            bot.sendMessage(chatId,
                "💰 *Sidee lacag loo dhigtaa?*\n\n" +
                "1️⃣ Fur boggayaga oo gal xisaabta\n" +
                "2️⃣ Guji *'Dhig Lacag'*\n" +
                "3️⃣ Dir lacagta EVC Plus numberka:\n" +
                "    📱 *+252 63 XXX XXXX*\n" +
                "4️⃣ Noo soo dir screenshots-ka ama nambarka confirmation-ka\n" +
                "5️⃣ Maamulka wuxuu xaqiijin doonaa si dhakhso ah ✅",
                { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: "⬅️ Ku noqo", callback_data: "back_menu" }]] } }
            );

        } else if (data === 'info_withdraw') {
            bot.sendMessage(chatId,
                "💸 *Sidee lacag loola baxaa?*\n\n" +
                "1️⃣ Fur boggayaga oo gal xisaabta\n" +
                "2️⃣ Guji *'Lacag Bixid'*\n" +
                "3️⃣ Geli cadadka lacagta iyo EVC Plus numberkaaga\n" +
                "4️⃣ Codsigaaga waxaa u diri maamulka\n" +
                "5️⃣ Lacagtu waxay ku soo gaari doontaa 5-15 daqiiqo gudahood 💸",
                { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: "⬅️ Ku noqo", callback_data: "back_menu" }]] } }
            );

        } else if (data === 'contact_admin') {
            // Put user in "contact admin" state so next message is forwarded
            userState[chatId] = 'CONTACT_ADMIN';
            bot.sendMessage(chatId,
                "📨 *Maamulka ii gudbi*\n\n" +
                "Qor fariintaada hoose — maamulku wuxuu kugu soo jawaabi doonaa si dhakhso ah.\n\n" +
                "✍️ Fariintaada qor hoos:",
                { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: "❌ Jooji", callback_data: "back_menu" }]] } }
            );

        } else if (data === 'back_menu') {
            // Show the main menu again
            bot.sendMessage(chatId,
                "👋 *Waxaad dooran kartaa mid kale:*",
                { parse_mode: 'Markdown', ...playerMenuOptions }
            );
        }

    } catch (err) {
        console.error("❌ Error in callback_query:", err);
    }
});

// ============================================================
// MESSAGE HANDLER (forwarding to admin, and admin replies)
// ============================================================
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) return;

    // ---- ADMIN REPLY LOGIC ----
    if (chatId.toString() === ADMIN_CHAT_ID) {
        if (msg.reply_to_message && msg.reply_to_message.text) {
            const repliedText = msg.reply_to_message.text;
            const idMatch = repliedText.match(/ID: (\d+)/);
            if (idMatch && idMatch[1]) {
                const playerId = idMatch[1];
                bot.sendMessage(playerId, `📬 *Jawaabta Maamulka:*\n\n${text}`, { parse_mode: 'Markdown' });
                bot.sendMessage(ADMIN_CHAT_ID, "✅ Jawaabtaada waa loo diray macmiilka!");
                return;
            }
        }
        return; // Ignore all other admin messages
    }

    // ---- PLAYER MESSAGE (forwarding to admin) ----
    if (userState[chatId] === 'CONTACT_ADMIN') {
        const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
        const adminMessage = `🚨 *Fariinta Cusub!*\n👤 Macmiil: ${username}\n🆔 ID: ${chatId}\n\n💬 Fariinta:\n"${text}"`;
        bot.sendMessage(ADMIN_CHAT_ID, adminMessage, { parse_mode: 'Markdown' });
        bot.sendMessage(chatId,
            "✅ *Fariintaada waa la diray maamulka!*\n\nWaxaan kugu soo jawaabi doonaa dhawaan.",
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: "⬅️ Ku noqo menu-ga", callback_data: "back_menu" }]] } }
        );
        delete userState[chatId];
    }
});

console.log("🤖 Telegram Bot initialized with 4-option player menu...");

module.exports = bot;
