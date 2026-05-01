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

// Track what the user is currently doing
const userState = {};

// Permanent Keyboard Options for Players
const keyboardOptions = {
    reply_markup: {
        keyboard: [
            [{ text: "💰 Lacag Dhigasho" }, { text: "💸 Lacag Labixid" }],
            [{ text: "🆘 Caawin" }]
        ],
        resize_keyboard: true, // Makes buttons fit nicely on phone screens
        is_persistent: true // Keeps the keyboard open
    }
};

// Permanent Keyboard Options for Admin (Inline Buttons)
const adminInlineOptions = {
    reply_markup: {
        inline_keyboard: [
            [{ text: "📊 Report (Maanta)", callback_data: "cmd_report" }],
            [{ text: "📈 Chart (7 Maalmood)", callback_data: "cmd_chart" }]
        ]
    }
};

// Welcome message
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  // If admin sends start, don't show the player menu
  if (chatId.toString() === ADMIN_CHAT_ID) {
      return bot.sendMessage(chatId, "👨‍💻 Welcome Admin! Waxaad halkan ka arki doontaa dhamaan fariimaha macmiisha. Si aad ugu jawaabto, kaliya 'Reply' dheh fariinta aad rabto.\n\nRiix badhamadan hoose si aad xisaabta u aragto:", adminInlineOptions);
  }

  const welcomeMessage = `
👋 Kusoo dhawoow Somlaaduu Bot!

Fadlan taabo mid kamid ah badhamada (buttons-ka) hoose si aad u hesho adeega aad rabto:
  `;
  
  bot.sendMessage(chatId, welcomeMessage, keyboardOptions);
});

// Handling Deposits
const handleDeposit = (chatId) => {
  if (chatId.toString() === ADMIN_CHAT_ID) return;
  userState[chatId] = 'DEPOSIT 💰';
  bot.sendMessage(chatId, 
    "💰 *Lacag Dhigasho*\n\n" +
    "Fadlan soo dir xogtaan:\n" +
    "1. Numberka aad game-ka ku samaysatay\n" +
    "2. Cadadka lacagta aad soo dirtay ($)\n" +
    "3. Numberka aad lacagta kasoo dirtay", 
    { parse_mode: 'Markdown', ...keyboardOptions }
  );
};
bot.onText(/\/dhigasho/, (msg) => handleDeposit(msg.chat.id));
bot.onText(/💰 Lacag Dhigasho/, (msg) => handleDeposit(msg.chat.id));

// Handling Withdrawals
const handleWithdrawal = (chatId) => {
    if (chatId.toString() === ADMIN_CHAT_ID) return;
    userState[chatId] = 'WITHDRAW 💸';
    bot.sendMessage(chatId, 
      "💸 *Lacag Labixid*\n\n" +
      "Fadlan soo dir xogtaan:\n" +
      "1. Numberka aad game-ka ku samaysatay\n" +
      "2. Cadadka lacagta aad labaxaysid ($)\n" +
      "3. Numberka EVC plus ee lacagta laguugu soo dirayo", 
      { parse_mode: 'Markdown', ...keyboardOptions }
    );
};
bot.onText(/\/labixid/, (msg) => handleWithdrawal(msg.chat.id));
bot.onText(/💸 Lacag Labixid/, (msg) => handleWithdrawal(msg.chat.id));

// Help command
const handleHelp = (chatId) => {
    if (chatId.toString() === ADMIN_CHAT_ID) return;
    userState[chatId] = 'CAAWIN 🆘';
    bot.sendMessage(chatId, "Hadii aad qabtid su'aal ama u baahantahay caawinaad, fadlan halkan ku soo qor, maamulka ayaa kuu soo jawaabi doona dhawaan.", keyboardOptions);
};
bot.onText(/\/caawin/, (msg) => handleHelp(msg.chat.id));
bot.onText(/🆘 Caawin/, (msg) => handleHelp(msg.chat.id));

const generateReport = async (chatId) => {
    bot.sendMessage(chatId, "⏳ Diyaarinta report-ka maanta, fadlan sug...");

    try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        // Get new users today
        const newUsers = await User.countDocuments({ createdAt: { $gte: startOfDay } });

        // Get total approved deposits today
        const deposits = await FinancialRequest.aggregate([
            { $match: { type: 'DEPOSIT', status: 'APPROVED', timestamp: { $gte: startOfDay } } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const totalDeposits = deposits.length > 0 ? deposits[0].total : 0;

        // Get total approved withdrawals today
        const withdrawals = await FinancialRequest.aggregate([
            { $match: { type: 'WITHDRAWAL', status: 'APPROVED', timestamp: { $gte: startOfDay } } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const totalWithdrawals = withdrawals.length > 0 ? withdrawals[0].total : 0;

        // Get first-time depositors today
        const firstTimeDepositorsQuery = await FinancialRequest.aggregate([
            { $match: { type: 'DEPOSIT', status: 'APPROVED' } },
            { $group: { _id: '$userId', firstDepositDate: { $min: '$timestamp' } } },
            { $match: { firstDepositDate: { $gte: startOfDay } } },
            { $count: 'count' }
        ]);
        const newDepositorsCount = firstTimeDepositorsQuery.length > 0 ? firstTimeDepositorsQuery[0].count : 0;

        // Get today's GGR (Gross Gaming Revenue from games only)
        const ggrQuery = await Revenue.aggregate([
            { $match: { timestamp: { $gte: startOfDay }, amount: { $gt: 0 } } },
            { $group: { _id: null, totalRevenue: { $sum: '$amount' } } }
        ]);
        const ggr = ggrQuery[0] ? ggrQuery[0].totalRevenue : 0;

        // Get gem revenue directly from User transactions (most reliable source)
        // Every gem purchase adds a transaction with type: 'gem_purchase'
        // Admin deposits: amount = gems count, price = gems * 0.01
        // Player purchases: description contains "for $X.XX"
        const gemTxQuery = await User.aggregate([
            { $unwind: '$transactions' },
            { $match: {
                'transactions.type': 'gem_purchase',
                $or: [
                    { 'transactions.timestamp': { $gte: startOfDay } },
                    { 'transactions.createdAt': { $gte: startOfDay } }
                ]
            }},
            { $project: {
                desc: '$transactions.description',
                gemCount: '$transactions.amount'
            }},
            { $group: {
                _id: null,
                totalGems: { $sum: '$gemCount' }
            }}
        ]);
        // 1 gem = $0.01
        const gemRevenue = gemTxQuery[0] ? gemTxQuery[0].totalGems * 0.01 : 0;

        // Get DAU (Unique active users today)
        const dauQuery = await Game.aggregate([
            { $match: { createdAt: { $gte: startOfDay }, status: { $in: ['ACTIVE', 'COMPLETED'] } } },
            { $unwind: '$players' },
            { $match: { 'players.isAI': false } },
            { $group: { _id: '$players.userId' } },
            { $count: 'total' }
        ]);
        const dau = dauQuery[0] ? dauQuery[0].total : 0;

        // Total Games played today
        const totalGames = await Game.countDocuments({
            createdAt: { $gte: startOfDay },
            status: { $in: ['ACTIVE', 'COMPLETED'] }
        });

        // Playable Users and Balance
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

// Map /report command to the function
bot.onText(/\/report/, (msg) => {
    if (msg.chat.id.toString() === ADMIN_CHAT_ID) generateReport(msg.chat.id);
});

const generateChart = async (chatId) => {
    bot.sendMessage(chatId, "🎨 Sawirida graph-ka, fadlan sug...");

    try {
        const last7Days = new Date();
        last7Days.setDate(last7Days.getDate() - 6);
        last7Days.setHours(0, 0, 0, 0);

        // Get daily sums for the last 7 days
        const data = await FinancialRequest.aggregate([
            { $match: { status: 'APPROVED', timestamp: { $gte: last7Days } } },
            { 
                $group: { 
                    _id: { 
                        date: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
                        type: "$type"
                    }, 
                    total: { $sum: "$amount" } 
                } 
            }
        ]);

        const dates = [];
        const depositsMap = {};
        const withdrawalsMap = {};

        // Generate the last 7 day labels (MM-DD)
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            dates.push(dateStr.slice(5)); // e.g., '05-01'
            depositsMap[dateStr] = 0;
            withdrawalsMap[dateStr] = 0;
        }

        // Fill data
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
            options: {
                title: { display: true, text: 'Lacagta la dhigtay vs Lala baxay (7 Maalmood)' }
            }
        };

        const chartUrl = `https://quickchart.io/chart?width=500&height=300&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
        
        bot.sendPhoto(chatId, chartUrl, { caption: "📈 Graph-ka dhaqaalaha 7-dii maalmood ee lasoo dhaafay." });

    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "❌ Cilad ayaa dhacday graph-ka, isku day mar kale.");
    }
};

// Map /chart command to the function
bot.onText(/\/chart/, (msg) => {
    if (msg.chat.id.toString() === ADMIN_CHAT_ID) generateChart(msg.chat.id);
});

// Listen for Inline Button clicks
bot.on('callback_query', async (query) => {
    console.log("🔘 Button clicked! Data:", query.data);
    
    try {
        const chatId = query.message.chat.id;
        const data = query.data;

        // Only Admin can click these
        if (chatId.toString() !== ADMIN_CHAT_ID) {
            console.log("❌ Unauthorized button click from:", chatId);
            return;
        }

        await bot.answerCallbackQuery(query.id).catch(e => console.error("Error answering query:", e));

        if (data === 'cmd_report') {
            console.log("📊 Triggering generateReport...");
            await generateReport(chatId);
        } else if (data === 'cmd_chart') {
            console.log("📈 Triggering generateChart...");
            await generateChart(chatId);
        }
    } catch (err) {
        console.error("❌ Error in callback_query:", err);
    }
});

// Listen to all messages
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  
  // Ignore missing text or commands
  if (!text || text.startsWith('/')) return;

  // ==========================================
  // ADMIN REPLY LOGIC
  // ==========================================
  if (chatId.toString() === ADMIN_CHAT_ID) {
      // Check if Admin is replying to a specific message
      if (msg.reply_to_message && msg.reply_to_message.text) {
          const repliedText = msg.reply_to_message.text;
          
          // Extract the player's Chat ID from the text
          const idMatch = repliedText.match(/ID: (\d+)/);
          
          if (idMatch && idMatch[1]) {
              const playerId = idMatch[1];
              
              // Send the admin's reply back to the player directly as text
              bot.sendMessage(playerId, text);
              
              // Confirm to admin that it was sent
              bot.sendMessage(ADMIN_CHAT_ID, "✅ Jawaabtaada waa loo diray macmiilka!");
              return;
          }
      }
      
      // If admin just types normally without replying, ignore it
      return; 
  }
  
  // ==========================================
  // PLAYER MESSAGE LOGIC
  // ==========================================
  const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;

  // Don't forward the button clicks themselves to the admin
  if (text === "💰 Lacag Dhigasho" || text === "💸 Lacag Labixid" || text === "🆘 Caawin") return;

  if (text.length > 2) {
     bot.sendMessage(chatId, "✅ Daqiiqado kadib walagu so jawabaya walal", keyboardOptions);
     
     const actionType = userState[chatId] || 'FARIIN CAADI AH 📩';
     
     // IMPORTANT: We inject 'ID: xxxxx' so the Admin can reply to it later
     const adminMessage = `🚨 *Codsiga Cusub!* (${actionType})\n👤 Macmiil: ${username}\n🆔 ID: ${chatId}\n\n💬 Fariinta:\n"${text}"`;
     
     // Send to Admin
     bot.sendMessage(ADMIN_CHAT_ID, adminMessage);
     
     delete userState[chatId];
  }
});

console.log("🤖 Telegram Bot initialized with Reply feature...");

module.exports = bot;
