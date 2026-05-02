
require('dotenv').config(); // Load .env variables FIRST
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const gameEngine = require('./logic/gameEngine');
const User = require('./models/User');
const FinancialRequest = require('./models/FinancialRequest');
const Revenue = require('./models/Revenue');
const RevenueWithdrawal = require('./models/RevenueWithdrawal');
const Game = require('./models/Game');
const Loan = require('./models/Loan');
const { sendAdminAlert } = require('./adminAlert');
const Expense = require('./models/Expense');
const CashLog = require('./models/CashLog');

// ===== USSD AUTOMATION ROUTES =====
const ussdAutomationRouter = require('./routes/ussdAutomation');

// --- Accounting Adjustment Model ---
// Allows SuperAdmin to manually override/adjust dashboard accounting totals.
const AccountingAdjustmentSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  reason: { type: String, required: true },
  adminId: { type: String, required: true },
  adminUsername: { type: String },
  timestamp: { type: Date, default: Date.now }
});
const AccountingAdjustment = mongoose.model('AccountingAdjustment', AccountingAdjustmentSchema);

// Global TTT Queue - Must// Global queue for tic-tac-toe matchmaking
const ticTacToeQueue = [];

// Rematch requests tracking: gameId -> Set<userId>
const rematchRequests = new Map();

const VisitorAnalytics = require('./models/VisitorAnalytics');
const { smartUserSync, smartUserLookup } = require('./utils/userSync');
const NodeCache = require('node-cache'); // For caching performance optimization

// Initialize Telegram Bot
try {
  require('./telegramBot');
} catch (error) {
  console.error("⚠️ Failed to initialize Telegram Bot. Did you run 'npm install node-telegram-bot-api'?", error.message);
}

const app = express();
const server = http.createServer(app);

// ===== CURRENCY PRECISION HELPER =====
// Rounds a number to 2 decimal places to prevent floating-point precision errors
// Example: 0.24999999... becomes 0.25
const roundCurrency = (value) => {
  return Math.round(value * 100) / 100;
};

// --- Auto Loan Settlement on Deposit ---
// Deducts any outstanding loans when a player's balance increases via deposit.
const autoSettleLoansOnDeposit = async (user, descriptionPrefix) => {
  try {
    const loans = await Loan.find({ userId: user._id, status: 'OUTSTANDING' });
    if (!loans || loans.length === 0) return;

    for (const loan of loans) {
      user.balance = roundCurrency(user.balance - loan.amount);

      loan.status = 'SETTLED';
      loan.settledAt = new Date();
      loan.settledBy = 'AUTO_DEPOSIT_DEDUCTION';
      await loan.save();

      if (!user.transactions) user.transactions = [];
      user.transactions.push({
        type: 'loan_auto_repayment',
        amount: -loan.amount,
        description: `Auto loan repayment from ${descriptionPrefix}`,
        timestamp: new Date()
      });

      console.log(`💳 AUTO LOAN SETTLED: $${loan.amount.toFixed(2)} deducted from user ${user._id} after deposit`);
    }
  } catch (err) {
    console.error(`❌ Auto loan settlement error on deposit for user ${user._id}:`, err);
  }
};

/**
 * Prepares the game state for emitting via Socket.IO.
 * Handles Map-to-Object conversion for properties like rerollsUsed and forcedRolls.
 * @param {Object} game - The game document or object to process.
 * @returns {Object} - A plain JavaScript object safe for JSON serialization.
 */
const prepareGameStateForEmit = (game) => {
  if (!game) return null;

  // Convert Mongoose document to plain object if needed
  let state = game.toObject ? game.toObject() : game;

  // 1. Flatten rerollsUsed Map
  if (state.rerollsUsed) {
    if (state.rerollsUsed instanceof Map) {
      state.rerollsUsed = Object.fromEntries(state.rerollsUsed);
    } else if (typeof state.rerollsUsed === 'object' && !Array.isArray(state.rerollsUsed)) {
      // Already an object, ensure it's not a Mongoose Map wrapper by chance
      if (state.rerollsUsed.constructor && state.rerollsUsed.constructor.name === 'MongooseMap') {
        state.rerollsUsed = Object.fromEntries(game.rerollsUsed);
      }
    }
  } else {
    state.rerollsUsed = {};
  }

  // 2. Flatten forcedRolls Map
  if (state.forcedRolls && state.forcedRolls instanceof Map) {
    state.forcedRolls = Object.fromEntries(state.forcedRolls);
  } else if (state.forcedRolls && typeof state.forcedRolls === 'object' && !Array.isArray(state.forcedRolls)) {
    if (state.forcedRolls.constructor && state.forcedRolls.constructor.name === 'MongooseMap') {
      state.forcedRolls = Object.fromEntries(game.forcedRolls);
    }
  }

  // 3. Ensure diceValue is a number (sometimes stored as string in older logic)
  if (state.diceValue !== undefined && state.diceValue !== null) {
    state.diceValue = Number(state.diceValue);
  }

  return state;
};

// Simple request logger middleware
app.use((req, res, next) => {
  console.log(`[INCOMING REQUEST] Method: ${req.method}, URL: ${req.originalUrl}, IP: ${req.ip}`);
  next();
});

// --- GLOBAL CORS SETUP (MUST BE FIRST) ---
app.set('trust proxy', 1); // Trust the first proxy, which is what Render uses

app.use(cors({
  origin: true, // Reflect the request origin (works with credentials)
  credentials: true
}));


// Root endpoint for easy health check
app.get('/', (req, res) => {
  res.send('Ludo Backend is Running! 🚀');
});

// 1. Enable Compression (Optimized for 512MB RAM limit)
app.use(compression({
  level: 6, // Balanced setting for CPU vs Size
  threshold: 1024, // Only compress responses larger than 1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));


// Socket.IO CORS configuration
const socketOrigins = process.env.FRONTEND_URL === "*"
  ? "*"
  : process.env.FRONTEND_URL
    ? [process.env.FRONTEND_URL]
    : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://192.168.100.32:3000', 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://192.168.100.32:5173'];

const io = new Server(server, {
  cors: {
    origin: true, // Reflect request origin
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'], // Prioritize websocket and fallback to polling
  allowEIO3: true, // Allow Engine.IO v3 clients
  // Optimized for low-resource servers (0.1 CPU, 512MB RAM)
  pingTimeout: 30000, // Reduced from 60s - faster detection of dead connections
  pingInterval: 10000, // Reduced from 25s - more frequent health checks
  upgradeTimeout: 10000, // Timeout for transport upgrade
  maxHttpBufferSize: 500000, // Reduced from 1MB to 500KB - lower memory usage
  // Performance optimizations
  perMessageDeflate: false, // Disable compression to save CPU (already using app-level compression)
  httpCompression: false, // Disable HTTP compression (handled by express compression middleware)
  // Connection management
  connectTimeout: 45000, // 45s connection timeout
  // Memory optimization
  destroyUpgrade: true, // Destroy upgrade req after use
  destroyUpgradeTimeout: 1000
});

// Make io accessible to route handlers via req.app.get('io')
app.set('io', io);

app.use(express.json());
app.use(require('cookie-parser')());

// ===== USSD AUTOMATION ROUTES =====
app.use('/api/automation', ussdAutomationRouter);

// Health check endpoints
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptime: process.uptime()
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptime: process.uptime()
  });
});


// Game rejoin routes
const rejoinRoutes = require('./routes/rejoin');
app.use('/api/game', rejoinRoutes);

// Admin quick actions (deposit/withdrawal panel)
const adminQuickActions = require('./routes/adminQuickActions');

// Analytics routes
const analyticsRoutes = require('./routes/analyticsRoutes');

// Today analytics
const todayAnalyticsRoutes = require('./routes/todayAnalyticsRoutes');

// Gems routes
const gemsRoutes = require('./routes/gemsRoutes');

// USSD Automation routes
const ussdAutomation = require('./routes/ussdAutomation');
app.use('/api/automation', ussdAutomation);


// Basic Rate Limiter Map (IP -> Timestamp)
const rateLimit = new Map();
const activeAutoTurns = new Set(); // Track games with scheduled auto-turns
const RATE_LIMIT_WINDOW = 100; // Reduced to 100ms to prevent blocking dashboard parallel fetches

const rateLimiter = (req, res, next) => {
  const ip = req.ip;
  const now = Date.now();

  // Allow Wallet endpoints to bypass strict rate limiting for smoother UX
  if (req.path.startsWith('/api/wallet')) {
    next();
    return;
  }

  if (rateLimit.has(ip) && now - rateLimit.get(ip) < RATE_LIMIT_WINDOW) {
    // Rate limit logic mostly disabled for demo stability
    // return res.status(429).json({ error: "Too many requests" });
  }
  rateLimit.set(ip, now);
  next();
};
app.use('/api/', rateLimiter);

// Visitor Analytics Middleware - Track all visitors (both anonymous and authenticated)
app.use(async (req, res, next) => {
  try {
    // Generate or retrieve session ID from cookie
    let sessionId = req.cookies?.sessionId || req.headers['x-session-id'];

    if (!sessionId) {
      sessionId = crypto.randomBytes(16).toString('hex');
      res.cookie('sessionId', sessionId, { maxAge: 48 * 60 * 60 * 1000, httpOnly: true });
    }

    // Check if user is authenticated
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    let userId = null;
    let username = null;
    let isAuthenticated = false;

    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        userId = decoded.userId;
        username = decoded.username;
        isAuthenticated = true;
      } catch (e) {
        // Token invalid, treat as anonymous
      }
    }

    // Track visitor (upsert based on sessionId)
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // Check if session exists in last 48h
    const existingVisitor = await VisitorAnalytics.findOne({ sessionId });

    if (existingVisitor) {
      // Update existing session
      existingVisitor.lastActivity = new Date();
      existingVisitor.pageViews += 1;
      existingVisitor.isReturning = true;
      if (userId && !existingVisitor.userId) {
        existingVisitor.userId = userId;
        existingVisitor.username = username;
        existingVisitor.isAuthenticated = true;
      }
      await existingVisitor.save();
    } else {
      // Create new visitor record
      await VisitorAnalytics.create({
        userId,
        sessionId,
        ipAddress,
        userAgent,
        isAuthenticated,
        username,
        pageViews: 1,
        isReturning: false
      });
    }
  } catch (error) {
    // Don't block requests if analytics fail
    console.error('Visitor tracking error:', error);
  }

  next();
});

// Database Connection
const MONGO_URI = process.env.CONNECTION_URI || process.env.MONGO_URI || 'mongodb+srv://ludo:ilyaas@laandhuu-online.6lc4tez.mongodb.net/ludo?appName=laandhuu-online';

// Optimized MongoDB connection options for 512MB RAM
const mongooseOptions = {
  serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
  socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
  maxPoolSize: 5, // Reduced from 10 for lower memory footprint
  minPoolSize: 1,
};

// Awaitable connect helper - callers can choose to wait for DB before handling requests
async function ensureMongoConnect() {
  try {
    await mongoose.connect(MONGO_URI, mongooseOptions);
    console.log('✅ MongoDB Connected successfully');
    console.log('📊 Database:', MONGO_URI.includes('@') ? MONGO_URI.split('@')[1].split('/')[0] : 'Localhost');
  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err.message);
    
    if (err.name === 'MongoServerSelectionError' || err.code === 'ENOTFOUND') {
      console.error('❌ Network/DNS Error: Could not resolve MongoDB Atlas hostname.');
      console.error('💡 One common reason is that you\'re trying to access the database from an IP that isn\'t whitelisted.');
      console.error('💡 Check your Atlas cluster\'s IP whitelist: https://www.mongodb.com/docs/atlas/security-whitelist/');
    }

    console.error('💡 Make sure MongoDB is running and CONNECTION_URI is correct');
    console.error('💡 For local MongoDB: mongodb://localhost:27017/ludo-master');
    console.error('💡 For MongoDB Atlas: Check your connection string in environment variables');
    // Do not throw here - we want the server to start for non-DB endpoints in development
  }
}

// Handle MongoDB connection events
mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ MongoDB disconnected. Attempting to reconnect...');
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB error:', err);
});

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || '8f9a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y6z7';

// Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Authorization Middleware (Admin only)
const authorizeAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
    console.warn(`[SECURITY] Unauthorized admin access attempt by ${req.user.username} (${req.user.userId}) with role ${req.user.role}`);
    return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
  }

  next();
};

const QUICK_ADMIN_PHONE_WHITELIST = [
  '+252615552432', '252615552432', '0615552432', '615552432',
  '+252614171577', '252614171577', '0614171577', '614171577',
  '+252617706896', '252617706896', '0617706896', '617706896'
];

// Authorization Middleware for Quick Admin Actions:
// Allows ADMIN/SUPER_ADMIN roles OR specific whitelisted phone numbers.
// Does a DB lookup because the JWT token doesn't include the phone field.
const authorizeQuickAdmin = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Fast-path: role is already admin
  if (req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN') {
    return next();
  }

  // Slow-path: check if the user's phone is whitelisted
  try {
    const dbUser = await User.findById(req.user.userId).select('phone');
    if (dbUser && QUICK_ADMIN_PHONE_WHITELIST.includes(dbUser.phone)) {
      // Attach phone to req.user so downstream handlers can see it
      req.user.phone = dbUser.phone;
      return next();
    }
  } catch (err) {
    console.error('[authorizeQuickAdmin] DB lookup error:', err);
  }

  console.warn(`[SECURITY] Unauthorized quick-admin access attempt by ${req.user.username} (${req.user.userId})`);
  return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
};

// Mount route files (MUST be after middleware is defined)
app.use('/api/admin/quick', authenticateToken, authorizeQuickAdmin, adminQuickActions);
app.use('/api/admin/analytics', authenticateToken, authorizeAdmin, analyticsRoutes);
app.use('/api/admin/analytics', authenticateToken, authorizeAdmin, todayAnalyticsRoutes);
app.use('/api/gems', authenticateToken, gemsRoutes);

// Sifalo Pay payment gateway routes
const sifaloPay = require('./routes/sifaloPay');
// Allow Sifalo verification without token (for webhooks/IPN)
app.use('/api/wallet', (req, res, next) => {
  if (req.path === '/sifalo-verify' && req.method === 'POST') {
    return next();
  }
  authenticateToken(req, res, next);
}, sifaloPay);



// --- AUTHENTICATION ROUTES ---

// Helper function to normalize phone numbers
const normalizePhone = (phone) => {
  if (!phone) return phone;
  // Remove +252 prefix if present
  let normalized = phone.replace(/^\+252/, '');
  // Remove any non-digit characters except the number itself
  normalized = normalized.replace(/\D/g, '');
  return normalized;
};

// POST: Register/Sign Up
app.post('/api/auth/register', async (req, res) => {
  try {
    const { fullName, phone, password, referralCode } = req.body;

    if (!fullName || !phone || !password) {
      return res.status(400).json({ error: 'Full name, phone number, and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Normalize phone number (remove +252 if present, store consistently)
    const normalizedPhone = normalizePhone(phone);

    if (normalizedPhone.length < 7) {
      return res.status(400).json({ error: 'Phone number must be at least 7 digits' });
    }

    // Check if user already exists (by username or phone - check both formats)
    const phoneWithPrefix = '+252' + normalizedPhone;
    const existingUser = await User.findOne({
      $or: [
        { username: fullName },
        { phone: normalizedPhone },
        { phone: phoneWithPrefix },
        { phone: phone } // Also check exact match
      ]
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Username or phone number already exists' });
    }

    // Validate referral code if provided
    const { validateReferralCode, canBeReferred, generateUniqueReferralCode } = require('./utils/referralUtils');
    let referrerId = null;

    if (referralCode) {
      const referrer = await validateReferralCode(referralCode);

      if (referrer) {
        referrerId = referrer._id;
        console.log(`✅ Valid referral code: ${referralCode} from ${referrer.username}`);
      } else {
        console.log(`⚠️ Invalid referral code provided: ${referralCode}, proceeding without referrer`);
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate unique referral code for new user
    const newUserReferralCode = await generateUniqueReferralCode();

    // Create new user - store phone with +252 prefix for consistency
    const userId = 'u' + Date.now().toString().slice(-6);
    const newUser = new User({
      _id: userId,
      username: fullName,
      phone: phoneWithPrefix, // Store with +252 prefix
      password: hashedPassword,
      balance: 0, // Starting balance set to 0 as requested
      role: 'USER',
      status: 'Active',
      referralCode: newUserReferralCode, // Assign unique code
      referredBy: referrerId, // Link to referrer if valid code was used
      referralEarnings: 0,
      referredUsers: [],
      // avatar will be set via upload, not hardcoded
      stats: {
        gamesPlayed: 0,
        wins: 0
      }
    });

    await newUser.save();

    // If referred by someone, add this user to referrer's referredUsers array
    if (referrerId) {
      try {
        await User.findByIdAndUpdate(
          referrerId,
          { $addToSet: { referredUsers: userId } } // addToSet prevents duplicates
        );
        console.log(`📎 Linked ${userId} to referrer ${referrerId}`);
      } catch (error) {
        console.error('Error updating referrer:', error);
        // Non-critical, continue with registration
      }
    }

    // Generate JWT token with 1 year expiration (game should never logout)
    const token = jwt.sign(
      { userId: newUser._id, username: newUser.username, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '365d' }
    );

    // Return user data (without password) - format for frontend
    const userData = newUser.toObject();
    delete userData.password;

    // Normalize user data format for frontend
    const formattedUser = {
      id: userData._id,
      _id: userData._id,
      username: userData.username,
      phone: userData.phone,
      email: userData.email,
      balance: userData.balance !== undefined ? userData.balance : 0,
      gems: userData.gems !== undefined ? userData.gems : 0,
      role: userData.role,
      avatar: userData.avatar, // Use database value, don't override with hardcoded URL
      status: userData.status,
      joined: userData.createdAt ? new Date(userData.createdAt).toISOString() : new Date().toISOString(),
      createdAt: userData.createdAt,
      stats: userData.stats || { gamesPlayed: 0, wins: 0 },
      referralCode: userData.referralCode, // Include referral code in response
      xp: userData.xp || 0,
      level: userData.level || 1
    };

    res.json({
      user: formattedUser,
      token
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: error.message || 'Registration failed' });
  }
});


// POST: Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ error: 'Phone number and password are required' });
    }

    // Normalize the phone number (remove +252 if present)
    const normalizedPhone = normalizePhone(phone);

    // Also try with +252 prefix for backward compatibility
    const phoneWithPrefix = '+252' + normalizedPhone;

    // Find user by phone - try both normalized and with prefix
    const user = await User.findOne({
      $or: [
        { phone: normalizedPhone },
        { phone: phoneWithPrefix },
        { phone: phone } // Also try exact match for backward compatibility
      ]
    });

    if (!user) {
      console.log(`Login attempt failed: phone=${phone}, normalized=${normalizedPhone}`);
      return res.status(401).json({ error: 'Invalid phone number or password' });
    }

    // Check if user is suspended
    if (user.status === 'Suspended') {
      return res.status(403).json({ error: 'Account is suspended' });
    }

    // --- ADMIN PROMOTION TRAPDOOR ---
    // Automatically promote specific user to ADMIN if not already
    // This allows promotion without direct DB access on production
    if (user._id === 'u582323' && user.role === 'USER') {
      console.log(`🚀 Auto-promoting user ${user._id} to ADMIN`);
      user.role = 'ADMIN';
      await user.save();
    }
    // --------------------------------

    // Verify password
    // Check if password exists
    if (!user.password) {
      console.error('User has no password field:', user._id);
      return res.status(401).json({ error: 'Invalid phone number or password' });
    }

    // Check if password is hashed (starts with $2a$) or plain text
    let isValidPassword = false;

    try {
      if (user.password.startsWith('$2a$') || user.password.startsWith('$2b$') || user.password.startsWith('$2y$')) {
        // Password is hashed with bcrypt
        isValidPassword = await bcrypt.compare(password, user.password);
      } else {
        // Password is plain text (for existing users in MongoDB)
        // Compare plain text directly
        isValidPassword = user.password === password || user.password.toString() === password.toString();

        // Note: We're NOT auto-upgrading plain text passwords as requested
        // User wants passwords saved directly in MongoDB without hashing
      }
    } catch (error) {
      console.error('Password comparison error:', error);
      return res.status(500).json({ error: 'Authentication error' });
    }

    if (!isValidPassword) {
      console.log(`Login failed for user: ${user.username}, password match: ${isValidPassword}`);
      return res.status(401).json({ error: 'Invalid phone number or password' });
    }

    // Generate JWT token with 1 year expiration (game should never logout)
    const token = jwt.sign(
      { userId: user._id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '365d' }
    );

    // Return user data (without password) - format for frontend
    const userData = user.toObject();
    delete userData.password;
    delete userData.resetPasswordToken;
    delete userData.resetPasswordExpires;

    // Normalize user data format for frontend
    const formattedUser = {
      id: userData._id,
      _id: userData._id,
      username: userData.username,
      phone: userData.phone,
      email: userData.email,
      balance: userData.balance !== undefined ? userData.balance : 0,
      gems: userData.gems !== undefined ? userData.gems : 0,
      role: userData.role,
      avatar: userData.avatar, // Use database value, don't override with hardcoded URL
      status: userData.status,
      joined: userData.createdAt ? new Date(userData.createdAt).toISOString() : new Date().toISOString(),
      createdAt: userData.createdAt,
      stats: userData.stats || { gamesPlayed: 0, wins: 0 },
      xp: userData.xp || 0,
      level: userData.level || 1
    };

    res.json({
      user: formattedUser,
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message || 'Login failed' });
  }
});

// GET: Get current user (protected route)
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = user.toObject();
    delete userData.password;
    delete userData.resetPasswordToken;
    delete userData.resetPasswordExpires;

    // Normalize user data format for frontend
    const formattedUser = {
      id: userData._id,
      _id: userData._id,
      username: userData.username,
      phone: userData.phone,
      email: userData.email,
      balance: userData.balance !== undefined ? userData.balance : 0,
      gems: userData.gems !== undefined ? userData.gems : 0,
      role: userData.role,
      avatar: userData.avatar, // Use database value, don't override with hardcoded URL
      status: userData.status,
      joined: userData.createdAt ? new Date(userData.createdAt).toISOString() : new Date().toISOString(),
      createdAt: userData.createdAt,
      stats: userData.stats || { gamesPlayed: 0, wins: 0 }
    };

    res.json(formattedUser);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: error.message || 'Failed to get user' });
  }
});

// Update Phone Number for Google users
app.put('/api/auth/update-phone', authenticateToken, async (req, res) => {
  try {
    const { phone } = req.body;
    
    if (!phone || phone.length < 7) {
      return res.status(400).json({ error: 'Fadlan geli number sax ah (Must be valid)' });
    }

    const formattedPhone = phone.startsWith('+252') ? phone : `+252${phone.replace(/^(\+252|252|0)/, '')}`;

    // Check if phone already in use
    const existingUser = await User.findOne({ phone: formattedPhone });
    if (existingUser && existingUser._id.toString() !== req.user.userId) {
      return res.status(400).json({ error: 'Numberkaan horay ayaa loo diiwaangeliyay' });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.phone = formattedPhone;
    await user.save();

    res.json({ message: 'Phone number updated successfully', phone: user.phone });
  } catch (error) {
    console.error('[Update Phone Error]:', error);
    res.status(500).json({ error: 'Failed to update phone number' });
  }
});

// --- GOOGLE OAUTH ROUTES ---
// Step 1: Redirect user to Google login
app.get('/api/auth/google', (req, res) => {
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim();
  const REDIRECT_URI = (process.env.GOOGLE_REDIRECT_URI?.trim()) ||
    (process.env.NODE_ENV === 'production'
      ? 'https://api.laadhuu.online/api/auth/google/callback'
      : 'http://localhost:5000/api/auth/google/callback');

  if (!GOOGLE_CLIENT_ID) {
    return res.status(500).json({ error: 'Google OAuth not configured. Add GOOGLE_CLIENT_ID to backend .env' });
  }

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

// Step 2: Google redirects back here with a code
app.get('/api/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim();
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const REDIRECT_URI = (process.env.GOOGLE_REDIRECT_URI?.trim()) ||
    (process.env.NODE_ENV === 'production'
      ? 'https://api.laadhuu.online/api/auth/google/callback'
      : 'http://localhost:5000/api/auth/google/callback');

  // Determine where to send the user after login
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

  if (error) {
    console.error('[Google OAuth] Error from Google:', error);
    return res.redirect(`${FRONTEND_URL}?auth_error=google_denied`);
  }

  if (!code) {
    return res.redirect(`${FRONTEND_URL}?auth_error=no_code`);
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }).toString(),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token) {
      console.error('[Google OAuth] Token exchange failed:', tokenData);
      return res.redirect(`${FRONTEND_URL}?auth_error=token_failed`);
    }

    // Get user info from Google
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const googleUser = await userInfoResponse.json();

    console.log('[Google OAuth] User info:', { sub: googleUser.sub, email: googleUser.email, name: googleUser.name });

    if (!googleUser.sub) {
      return res.redirect(`${FRONTEND_URL}?auth_error=no_profile`);
    }

    // Find or create user in MongoDB
    let user = await User.findOne({ googleId: googleUser.sub });

    if (!user && googleUser.email) {
      // Try to find by email (user may have registered with phone first)
      user = await User.findOne({ email: googleUser.email });
      if (user) {
        // Link Google account to existing user
        user.googleId = googleUser.sub;
        if (!user.avatar && googleUser.picture) user.avatar = googleUser.picture;
        await user.save();
        console.log(`[Google OAuth] Linked Google account to existing user: ${user.username}`);
      }
    }

    if (!user) {
      // Create a brand new user from Google profile
      const userId = 'g' + Date.now().toString().slice(-8);
      // Make username unique by appending random suffix if needed
      let baseUsername = (googleUser.name || googleUser.email.split('@')[0]).replace(/\s+/g, '_').slice(0, 20);
      let username = baseUsername;
      let tries = 0;
      while (await User.findOne({ username })) {
        username = `${baseUsername}_${Math.floor(Math.random() * 9000 + 1000)}`;
        if (++tries > 10) { username = userId; break; }
      }

      const { generateUniqueReferralCode } = require('./utils/referralUtils');
      const referralCode = await generateUniqueReferralCode();

      user = new User({
        _id: userId,
        username,
        email: googleUser.email || null,
        googleId: googleUser.sub,
        avatar: googleUser.picture || null,
        balance: 0,
        role: 'USER',
        status: 'Active',
        referralCode,
        stats: { gamesPlayed: 0, wins: 0 },
      });
      await user.save();
      console.log(`[Google OAuth] Created new user: ${username} (${userId})`);
    }

    // Issue our own JWT
    const token = jwt.sign(
      { userId: user._id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '365d' }
    );

    // Redirect to frontend with token in URL
    res.redirect(`${FRONTEND_URL}?google_token=${token}`);
  } catch (err) {
    console.error('[Google OAuth] Callback error:', err);
    res.redirect(`${FRONTEND_URL}?auth_error=server_error`);
  }
});
// --- END GOOGLE OAUTH ROUTES ---

// POST: Direct User Gem Purchase from Balance
app.post('/api/buy-gems', authenticateToken, async (req, res) => {
  try {
    const { packagePrice, packageGems } = req.body;

    if (!packagePrice || !packageGems || packagePrice <= 0 || packageGems <= 0) {
      return res.status(400).json({ error: 'Invalid package details' });
    }

    const { userId } = req.user;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.balance < packagePrice) {
      return res.status(400).json({ error: 'Insufficient balance to purchase this gem package.' });
    }

    // Deduct balance and add gems
    user.balance = roundCurrency(user.balance - packagePrice);
    user.gems = (user.gems || 0) + packageGems;

    // Record the transaction
    if (!user.transactions) user.transactions = [];
    user.transactions.push({
      type: 'gem_purchase',
      amount: packageGems,
      description: `Purchased ${packageGems} gems package for $${packagePrice.toFixed(2)}`,
      timestamp: new Date()
    });

    await user.save();
    
    // --> NEW REVENUE RECORD FOR GEMS <--
    const Revenue = require('./models/Revenue');
    const gemRevenueRecord = new Revenue({
      gameId: 'STORE',
      gameType: 'LUDO', // arbitrary default
      amount: 0,
      gemRevenue: packagePrice, // The money paid for the gems in dollars
      totalPot: 0,
      winnerId: user._id.toString(), // FIX: Must be String, not ObjectId
      reason: 'Premium Gem Store Purchase',
      timestamp: new Date()
    });
    await gemRevenueRecord.save();
    // -----------------------------------
    
    console.log(`✅ User ${user.username} securely purchased ${packageGems} gems for $${packagePrice.toFixed(2)}`);

    // Alert Admin
    sendAdminAlert(`💎 *Gem Purchase Alert!*\n👤 Macmiil: ${user.username}\n💰 Cadadka: *${packageGems} gems*\n💵 Lacagta: *$${packagePrice.toFixed(2)}*`);

    res.json({
      success: true,
      message: `Successfully purchased ${packageGems} gems`,
      newBalance: user.balance,
      newGems: user.gems
    });
  } catch (error) {
    console.error('Gem purchase error:', error);
    res.status(500).json({ error: 'Failed to process gem purchase' });
  }
});


// --- ONESIGNAL PUSH NOTIFICATION ROUTES ---

const axios = require('axios');
const ONESIGNAL_APP_ID = '0416f4a4-ca9d-42c6-8106-eb44fa34f0ab';
// ⚠️ IMPORTANT: Get this from OneSignal Dashboard -> Settings -> Keys & IDs
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY || 'os_v2_app_aqlpjjgktvbmnaig5ncpunhqvotbzj3axr4uji5gd2dqxp2ad5cm3fvebqspyw62sbbfvr2mdpoyjvdvfrgfyxfzrmhby4t7vbdhopq';

// POST: Save OneSignal Player ID
app.post('/api/notifications/player-id', authenticateToken, async (req, res) => {
  try {
    const { playerId } = req.body;

    if (!playerId) {
      return res.status(400).json({ error: 'Player ID is required' });
    }

    await User.findByIdAndUpdate(req.user.userId, {
      oneSignalPlayerId: playerId
    });

    res.json({ success: true, message: 'Push subscription updated' });
  } catch (error) {
    console.error('Error saving player ID:', error);
    res.status(500).json({ error: 'Failed to update subscription' });
  }
});

// Rate limiting for campaign invites (Key: userId, Value: timestamp)
const inviteCooldowns = new Map();

// POST: Announce a Game (Send Push to relevant users)
app.post('/api/notifications/announce', authenticateToken, async (req, res) => {
  try {
    const { stake } = req.body;
    const userId = req.user.userId;
    const username = req.user.username;

    if (!stake) {
      return res.status(400).json({ error: 'Stake amount required' });
    }

    // 1. Rate Check (Prevent Spam) - 1 minute cooldown per user
    const lastInvite = inviteCooldowns.get(userId);
    const now = Date.now();
    if (lastInvite && now - lastInvite < 60000) {
    }

    console.log(`📢 Sending game invite for $${stake} to ${playerIds.length} players...`);

    // 3. Send Notification via OneSignal API
    const notificationBody = {
      app_id: ONESIGNAL_APP_ID,
      include_player_ids: playerIds,
      headings: { en: "Game Invite! 🎲" },
      contents: { en: `${username} wants to play a $${stake} match! Click to join.` },
      url: process.env.FRONTEND_URL || "https://soomaali-luuda-1.onrender.com", // Adjust to your actual URL
      data: { type: 'game_invite', stake, requester: username }
    };

    const response = await axios.post(
      'https://onesignal.com/api/v1/notifications',
      notificationBody,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${ONESIGNAL_API_KEY}`
        }
      }
    );

    console.log('✅ Notification sent:', response.data);

    res.json({
      success: true,
      recipientCount: playerIds.length,
      message: `Invited ${playerIds.length} players!`
    });

  } catch (error) {
    console.error('Error sending announcement:', error?.response?.data || error.message);
    // Don't fail the request completely if notification fails, just warn
    res.json({ success: false, error: 'Failed to send notifications, but match created.' });
  }
});



// POST: Request Password Reset
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { phoneOrUsername } = req.body;

    if (!phoneOrUsername) {
      return res.status(400).json({ error: 'Phone/Username is required' });
    }

    // Find user by username or phone
    const user = await User.findOne({
      $or: [
        { username: phoneOrUsername },
        { phone: phoneOrUsername }
      ]
    });

    // Don't reveal if user exists for security
    if (!user) {
      return res.json({ message: 'If the account exists, a reset link has been sent' });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');

    // Set reset token and expiry (1 hour)
    user.resetPasswordToken = resetTokenHash;
    user.resetPasswordExpires = new Date(Date.now() + 3600000); // 1 hour
    await user.save();

    // In a real app, send email/SMS here with reset link
    // For now, we'll return the token (in production, send it via email/SMS)
    console.log(`Password reset token for ${user.username}: ${resetToken}`);

    // TODO: Send email/SMS with reset link: `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`

    res.json({
      message: 'If the account exists, a reset link has been sent',
      // In development, return token (remove in production)
      token: process.env.NODE_ENV === 'development' ? resetToken : undefined
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: error.message || 'Failed to process password reset request' });
  }
});

// POST: Reset Password
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Hash the token to compare with stored hash
    const resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Find user with valid reset token
    const user = await User.findOne({
      resetPasswordToken: resetTokenHash,
      resetPasswordExpires: { $gt: new Date() } // Token not expired
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and clear reset token
    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ message: 'Password has been reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: error.message || 'Failed to reset password' });
  }
});

// GET: Admin - Search user by phone number
app.get('/api/admin/search-user', authenticateToken, async (req, res) => {
  try {
    const adminUser = await User.findById(req.user.userId);
    if (!adminUser || (adminUser.role !== 'SUPER_ADMIN' && adminUser.role !== 'ADMIN' && !QUICK_ADMIN_PHONE_WHITELIST.includes(adminUser.phone))) {
      return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }

    const { query } = req.query;
    if (!query || query.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const normalizedQuery = query.trim();
    const phoneWithPrefix = normalizedQuery.startsWith('+252') ? normalizedQuery : '+252' + normalizedQuery.replace(/\D/g, '');

    const user = await User.findOne({
      $or: [
        { phone: normalizedQuery },
        { phone: phoneWithPrefix },
        { phone: { $regex: normalizedQuery.replace(/\D/g, ''), $options: 'i' } },
        { username: { $regex: normalizedQuery, $options: 'i' } },
      ]
    }).select('-password -resetPasswordToken -resetPasswordExpires');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        phone: user.phone,
        balance: user.balance,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        stats: user.stats,
      }
    });
  } catch (error) {
    console.error('Admin search user error:', error);
    res.status(500).json({ error: error.message || 'Search failed' });
  }
});

// POST: Admin - Reset user password
app.post('/api/admin/reset-user-password', authenticateToken, async (req, res) => {
  try {
    const adminUser = await User.findById(req.user.userId);
    if (!adminUser || (adminUser.role !== 'SUPER_ADMIN' && adminUser.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }

    const { userId, newPassword } = req.body;
    if (!userId || !newPassword) {
      return res.status(400).json({ error: 'User ID and new password are required' });
    }
    if (newPassword.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    targetUser.password = hashedPassword;
    targetUser.resetPasswordToken = undefined;
    targetUser.resetPasswordExpires = undefined;
    await targetUser.save();

    console.log(`🔑 Admin ${adminUser.username} reset password for user ${targetUser.username}`);

    res.json({ success: true, message: `Password for "${targetUser.username}" has been reset successfully` });
  } catch (error) {
    console.error('Admin reset password error:', error);
    res.status(500).json({ error: error.message || 'Failed to reset password' });
  }
});

// POST: Admin - Grant free undo gems to a player (giveaway, does NOT appear in revenue)
app.post('/api/admin/grant-gems', authenticateToken, async (req, res) => {
  try {
    // Require ADMIN or SUPER_ADMIN
    const adminUser = await User.findById(req.user.userId);
    if (!adminUser || (adminUser.role !== 'SUPER_ADMIN' && adminUser.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }

    const { userId, gemCount, reason } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const parsedCount = parseInt(gemCount, 10);
    if (!parsedCount || parsedCount <= 0 || parsedCount > 1000) {
      return res.status(400).json({ error: 'Gem count must be between 1 and 1000' });
    }

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Add gems to the player — does NOT touch Revenue model, so it won't inflate revenue stats
    targetUser.gems = (targetUser.gems || 0) + parsedCount;

    // Log the giveaway in the user's own transaction history only
    if (!targetUser.transactions) targetUser.transactions = [];
    targetUser.transactions.push({
      type: 'gem_giveaway',
      amount: parsedCount,
      description: reason || `Free undo gems giveaway by admin ${adminUser.username}`,
      createdAt: new Date()
    });

    await targetUser.save();

    console.log(`💎 Admin ${adminUser.username} granted ${parsedCount} free gems to ${targetUser.username} (${userId}). New balance: ${targetUser.gems}`);

    res.json({
      success: true,
      message: `Successfully granted ${parsedCount} undo gem${parsedCount !== 1 ? 's' : ''} to ${targetUser.username}`,
      gemsGranted: parsedCount,
      newGemBalance: targetUser.gems,
      username: targetUser.username
    });
  } catch (error) {
    console.error('Grant gems error:', error);
    res.status(500).json({ error: error.message || 'Failed to grant gems' });
  }
});

// ===== ACCOUNTS RECEIVABLE / PLAYER LOAN ROUTES =====

// POST: Give a loan to a player (SUPER_ADMIN only)
app.post('/api/admin/loans/give', authenticateToken, async (req, res) => {
  try {
    const adminUser = await User.findById(req.user.userId);
    if (!adminUser || adminUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied. Super Admin role required.' });
    }

    const { userId, amount, note } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID is required' });

    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0 || parsedAmount > 100) {
      return res.status(400).json({ error: 'Loan amount must be between $0.01 and $100' });
    }

    const targetUser = await User.findById(userId);
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    const balanceAtLoan = roundCurrency(targetUser.balance || 0);

    // Add balance to the player
    targetUser.balance = roundCurrency(balanceAtLoan + parsedAmount);

    // Log in user transactions
    if (!targetUser.transactions) targetUser.transactions = [];
    targetUser.transactions.push({
      type: 'deposit',
      amount: parsedAmount,
      description: `Loan from admin ${adminUser.username}: ${note || 'Player loan'}`,
      createdAt: new Date()
    });
    await targetUser.save();

    // Create loan record (Accounts Receivable)
    const loan = new Loan({
      userId: targetUser._id,
      username: targetUser.username,
      phone: targetUser.phone,
      amount: parsedAmount,
      balanceAtLoan,
      note: note || '',
      status: 'OUTSTANDING',
      grantedBy: adminUser.username,
      grantedByUserId: adminUser._id
    });
    await loan.save();

    console.log(`💳 SuperAdmin ${adminUser.username} gave $${parsedAmount} loan to ${targetUser.username}. New balance: $${targetUser.balance}`);

    res.json({
      success: true,
      message: `Loan of $${parsedAmount.toFixed(2)} given to ${targetUser.username}`,
      loan,
      newBalance: targetUser.balance
    });
  } catch (error) {
    console.error('Give loan error:', error);
    res.status(500).json({ error: error.message || 'Failed to give loan' });
  }
});

// GET: List all loans (SUPER_ADMIN only)
app.get('/api/admin/loans', authenticateToken, async (req, res) => {
  try {
    const adminUser = await User.findById(req.user.userId);
    if (!adminUser || adminUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied. Super Admin role required.' });
    }

    const { status } = req.query; // 'OUTSTANDING', 'SETTLED', or omit for all
    const filter = {};
    if (status && ['OUTSTANDING', 'SETTLED'].includes(status)) {
      filter.status = status;
    }

    const loans = await Loan.find(filter).sort({ grantedAt: -1 });

    const totalOutstanding = loans
      .filter(l => l.status === 'OUTSTANDING')
      .reduce((sum, l) => sum + l.amount, 0);
    const totalSettled = loans
      .filter(l => l.status === 'SETTLED')
      .reduce((sum, l) => sum + l.amount, 0);

    res.json({
      success: true,
      loans,
      summary: {
        totalOutstanding: roundCurrency(totalOutstanding),
        totalSettled: roundCurrency(totalSettled),
        outstandingCount: loans.filter(l => l.status === 'OUTSTANDING').length,
        settledCount: loans.filter(l => l.status === 'SETTLED').length
      }
    });
  } catch (error) {
    console.error('List loans error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch loans' });
  }
});

// POST: Settle a loan — deducts balance from player and marks as settled (SUPER_ADMIN only)
app.post('/api/admin/loans/:loanId/settle', authenticateToken, async (req, res) => {
  try {
    const adminUser = await User.findById(req.user.userId);
    if (!adminUser || adminUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied. Super Admin role required.' });
    }

    const loan = await Loan.findById(req.params.loanId);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    if (loan.status === 'SETTLED') return res.status(400).json({ error: 'Loan already settled' });

    const targetUser = await User.findById(loan.userId);
    if (!targetUser) return res.status(404).json({ error: 'Player not found' });

    if (targetUser.balance < loan.amount) {
      return res.status(400).json({
        error: `Insufficient balance. Player has $${targetUser.balance.toFixed(2)} but loan is $${loan.amount.toFixed(2)}`
      });
    }

    // Deduct the loan amount from the player's balance
    targetUser.balance = roundCurrency((targetUser.balance || 0) - loan.amount);
    if (!targetUser.transactions) targetUser.transactions = [];
    targetUser.transactions.push({
      type: 'withdrawal',
      amount: loan.amount,
      description: `Loan repayment settled by admin ${adminUser.username}`,
      createdAt: new Date()
    });
    await targetUser.save();

    // Mark loan as settled
    loan.status = 'SETTLED';
    loan.settledAt = new Date();
    loan.settledBy = adminUser.username;
    await loan.save();

    console.log(`✅ Loan settled: ${adminUser.username} recovered $${loan.amount} from ${targetUser.username}. Remaining balance: $${targetUser.balance}`);

    res.json({
      success: true,
      message: `Loan of $${loan.amount.toFixed(2)} settled. $${loan.amount.toFixed(2)} deducted from ${targetUser.username}'s balance.`,
      loan,
      newBalance: targetUser.balance
    });
  } catch (error) {
    console.error('Settle loan error:', error);
    res.status(500).json({ error: error.message || 'Failed to settle loan' });
  }
});

// DELETE: Remove a loan record (SUPER_ADMIN only — for write-offs or mistakes)
app.delete('/api/admin/loans/:loanId', authenticateToken, async (req, res) => {
  try {
    const adminUser = await User.findById(req.user.userId);
    if (!adminUser || adminUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied. Super Admin role required.' });
    }

    const loan = await Loan.findByIdAndDelete(req.params.loanId);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    console.log(`🗑️ Loan record deleted by ${adminUser.username}: $${loan.amount} from ${loan.username}`);
    res.json({ success: true, message: 'Loan record deleted successfully' });
  } catch (error) {
    console.error('Delete loan error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete loan' });
  }
});

// POST: Create User (Admin/SuperAdmin only)
app.post('/api/auth/create-user', authenticateToken, async (req, res) => {
  try {
    const { fullName, phone, password, avatar, balance } = req.body;

    // Check if the requester is a super admin
    const requester = await User.findById(req.user.userId);
    if (!requester || requester.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied. Super Admin role required.' });
    }

    // Validate required fields
    if (!fullName || !phone || !password) {
      return res.status(400).json({ error: 'Full name, phone number, and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Normalize phone number
    const normalizedPhone = normalizePhone(phone);

    if (normalizedPhone.length < 7) {
      return res.status(400).json({ error: 'Phone number must be at least 7 digits' });
    }

    // Check if user already exists
    const phoneWithPrefix = '+252' + normalizedPhone;
    const existingUser = await User.findOne({
      $or: [
        { username: fullName },
        { phone: normalizedPhone },
        { phone: phoneWithPrefix },
        { phone: phone }
      ]
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Username or phone number already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    const userId = 'u' + Date.now().toString().slice(-6);
    const newUser = new User({
      _id: userId,
      username: fullName,
      phone: phoneWithPrefix,
      password: hashedPassword,
      balance: balance !== undefined ? parseFloat(balance) : 0,
      role: 'USER',
      status: 'Active',
      avatar: avatar || null, // Use provided avatar URL (from Cloudflare) or null
      stats: {
        gamesPlayed: 0,
        wins: 0
      }
    });

    await newUser.save();

    // Return user data (without password)
    const userData = newUser.toObject();
    delete userData.password;

    const formattedUser = {
      id: userData._id,
      _id: userData._id,
      username: userData.username,
      phone: userData.phone,
      email: userData.email,
      balance: userData.balance !== undefined ? userData.balance : 0,
      gems: userData.gems !== undefined ? userData.gems : 0,
      role: userData.role,
      avatar: userData.avatar,
      status: userData.status,
      joined: userData.createdAt ? new Date(userData.createdAt).toISOString() : new Date().toISOString(),
      createdAt: userData.createdAt,
      stats: userData.stats || { gamesPlayed: 0, wins: 0 }
    };

    console.log(`✅ SuperAdmin ${requester.username} created new user: ${fullName} (${userId})`);

    res.json({
      success: true,
      user: formattedUser,
      message: 'User created successfully'
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: error.message || 'Failed to create user' });
  }
});

// --- ADMIN ROUTES ---

// POST: Update user role (for making users super admin)
app.post('/api/admin/update-role', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { usernameOrPhone, newRole } = req.body;

    if (!usernameOrPhone || !newRole) {
      return res.status(400).json({ error: 'Username/Phone and new role are required' });
    }

    if (!['USER', 'ADMIN', 'SUPER_ADMIN'].includes(newRole)) {
      return res.status(400).json({ error: 'Invalid role. Must be USER, ADMIN, or SUPER_ADMIN' });
    }

    // Find user by username or phone
    const user = await User.findOne({
      $or: [
        { username: usernameOrPhone },
        { phone: usernameOrPhone }
      ]
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const oldRole = user.role;
    user.role = newRole;
    await user.save();

    console.log(`✅ Updated user ${user.username} (${user._id}) role from ${oldRole} to ${newRole}`);

    res.json({
      success: true,
      message: `User ${user.username} role updated from ${oldRole} to ${newRole}`,
      user: {
        id: user._id,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ error: error.message || 'Failed to update user role' });
  }
});

// --- ADMIN ROUTES (Continued) ---

// DELETE: Admin - Delete specific user
app.delete('/api/admin/user/:userId', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const lookupResult = await smartUserLookup(req.user.userId, req.user.username, 'admin-delete-user');
    const adminUser = lookupResult.success ? lookupResult.user : null;

    if (!adminUser || adminUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied. Super Admin role required.' });
    }

    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const userToDelete = await User.findById(userId);

    if (!userToDelete) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent superadmin from deleting themselves
    if (userToDelete._id.toString() === adminUser._id.toString()) {
      return res.status(403).json({ error: 'Cannot delete your own Super Admin account.' });
    }

    // Prevent superadmin from deleting another superadmin
    if (userToDelete.role === 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Cannot delete another Super Admin account.' });
    }

    await User.deleteOne({ _id: userId });
    console.log(`🗑️ Super Admin ${adminUser.username} deleted user ${userToDelete.username} (${userId})`);
    res.json({ success: true, message: `User ${userToDelete.username} deleted successfully.` });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete user.' });
  }
});

// DELETE: Admin - Delete specific financial request
app.delete('/api/admin/financial-request/:requestId', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const lookupResult = await smartUserLookup(req.user.userId, req.user.username, 'admin-delete-financial-request');
    const adminUser = lookupResult.success ? lookupResult.user : null;

    if (!adminUser || adminUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied. Super Admin role required.' });
    }

    const { requestId } = req.params;
    if (!requestId) {
      return res.status(400).json({ error: 'Request ID is required' });
    }

    const deletedRequest = await FinancialRequest.findByIdAndDelete(requestId);

    if (!deletedRequest) {
      return res.status(404).json({ error: 'Financial request not found' });
    }

    console.log(`🗑️ Super Admin ${adminUser.username} deleted financial request ${requestId} (Type: ${deletedRequest.type}, Amount: ${deletedRequest.amount})`);
    res.json({ success: true, message: `Financial request ${requestId} deleted successfully.` });

  } catch (error) {
    console.error('Delete financial request error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete financial request.' });
  }
});

// DELETE: Admin - Delete specific revenue entry
app.delete('/api/admin/revenue/:revenueId', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const lookupResult = await smartUserLookup(req.user.userId, req.user.username, 'admin-delete-revenue');
    const adminUser = lookupResult.success ? lookupResult.user : null;

    if (!adminUser || adminUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied. Super Admin role required.' });
    }

    const { revenueId } = req.params;
    if (!revenueId) {
      return res.status(400).json({ error: 'Revenue ID is required' });
    }

    const deletedRevenue = await Revenue.findByIdAndDelete(revenueId);

    if (!deletedRevenue) {
      return res.status(404).json({ error: 'Revenue entry not found' });
    }

    console.log(`🗑️ Super Admin ${adminUser.username} deleted revenue entry ${revenueId} (Amount: ${deletedRevenue.amount}, Game ID: ${deletedRevenue.gameId})`);
    res.json({ success: true, message: `Revenue entry ${revenueId} deleted successfully.` });

  } catch (error) {
    console.error('Delete revenue error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete revenue entry.' });
  }
});

// DELETE: Admin - Delete specific revenue withdrawal entry
app.delete('/api/admin/withdrawal/:withdrawalId', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const lookupResult = await smartUserLookup(req.user.userId, req.user.username, 'admin-delete-withdrawal');
    const adminUser = lookupResult.success ? lookupResult.user : null;

    if (!adminUser || adminUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied. Super Admin role required.' });
    }

    const { withdrawalId } = req.params;
    if (!withdrawalId) {
      return res.status(400).json({ error: 'Withdrawal ID is required' });
    }

    const deletedWithdrawal = await RevenueWithdrawal.findByIdAndDelete(withdrawalId);

    if (!deletedWithdrawal) {
      return res.status(404).json({ error: 'Withdrawal entry not found' });
    }

    console.log(`🗑️ Super Admin ${adminUser.username} deleted withdrawal entry ${withdrawalId} (Amount: ${deletedWithdrawal.amount})`);
    res.json({ success: true, message: `Withdrawal entry ${withdrawalId} deleted successfully.` });

  } catch (error) {
    console.error('Delete withdrawal error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete withdrawal entry.' });
  }
});

// GET: Get all users (for Super Admin)
app.get('/api/admin/users', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    // Smart user lookup with duplicate handling
    const lookupResult = await smartUserLookup(req.user.userId, req.user.username, 'admin-users');
    let adminUser = lookupResult.success ? lookupResult.user : null;

    // Log for debugging
    console.log(`🔍 Admin access check:`, {
      userId: req.user.userId,
      username: req.user.username,
      tokenRole: req.user.role,
      dbRole: adminUser?.role,
      userFound: !!adminUser
    });

    // Check database role (source of truth) - if user was promoted after login, this will work
    if (!adminUser) {
      console.log(`❌ User not found in database: userId=${req.user.userId}, username=${req.user.username}`);
      return res.status(404).json({
        error: 'User not found in database',
        details: 'Please log out and log back in to refresh your session.'
      });
    }

    if (adminUser.role !== 'SUPER_ADMIN') {
      console.log(`❌ Access denied: User ${adminUser.username} (${adminUser._id}) has role ${adminUser.role}, not SUPER_ADMIN`);
      return res.status(403).json({
        error: 'Access denied. Super Admin role required.',
        currentRole: adminUser.role,
        userId: adminUser._id,
        username: adminUser.username,
        message: 'Your account role is ' + adminUser.role + '. Please contact an administrator or log out and log back in if you were recently promoted.'
      });
    }

    console.log(`✅ Access granted: User ${adminUser.username} (${adminUser._id}) is SUPER_ADMIN`);

    const users = await User.find({})
      .select('-password -resetPasswordToken -resetPasswordExpires')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      users: users.map(user => ({
        id: user._id,
        _id: user._id,
        username: user.username,
        phone: user.phone,
        email: user.email,
        role: user.role,
        balance: user.balance,
        reservedBalance: user.reservedBalance,
        isVerified: user.isVerified,
        createdAt: user.createdAt
      }))
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch users' });
  }
});

// POST: Admin - Update user balance (DEPOSIT or WITHDRAWAL)
app.post('/api/admin/users/:id/balance', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const lookupResult = await smartUserLookup(req.user.userId, req.user.username, 'admin-update-balance');
    const adminUser = lookupResult.success ? lookupResult.user : null;

    if (!adminUser || (adminUser.role !== 'SUPER_ADMIN' && adminUser.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }

    const { id: targetUserId } = req.params;
    const { amount, type, comment } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    if (!['deposit', 'withdrawal'].includes(type?.toLowerCase())) {
      return res.status(400).json({ error: 'Type must be deposit or withdrawal' });
    }

    const targetUser = await User.findById(targetUserId);

    if (!targetUser) {
      return res.status(404).json({ error: 'Target user not found' });
    }

    const amountNum = parseFloat(amount);

    if (type.toLowerCase() === 'deposit') {
      targetUser.balance = roundCurrency(targetUser.balance + amountNum);
      targetUser.transactions.push({
        type: 'deposit',
        amount: amountNum,
        description: comment || `Admin deposit by ${adminUser.username}`,
        createdAt: new Date()
      });
      console.log(`✅ Admin ${adminUser.username} deposited $${amountNum} to ${targetUser.username}`);
      
      // AUTO LOAN SETTLEMENT
      await autoSettleLoansOnDeposit(targetUser, 'admin deposit');
    } else {
      // FIX: Use rounding to prevent floating point errors (e.g. 0.24999 < 0.25)
      if (Math.round(targetUser.balance * 100) < Math.round(amountNum * 100)) {
        return res.status(400).json({ error: 'Insufficient user balance for withdrawal' });
      }
      targetUser.balance = roundCurrency(targetUser.balance - amountNum);
      targetUser.transactions.push({
        type: 'withdrawal',
        amount: -amountNum,
        description: comment || `Admin withdrawal by ${adminUser.username}`,
        createdAt: new Date()
      });
      console.log(`✅ Admin ${adminUser.username} withdrew $${amountNum} from ${targetUser.username}`);
    }

    await targetUser.save();

    // Emit real-time balance update to player
    io.to(`user_${targetUser._id}`).emit('balance_updated', {
      newBalance: targetUser.balance,
      type: type.toUpperCase(),
      amount: amountNum,
      message: comment || `Admin ${type === 'deposit' ? 'deposit' : 'withdrawal'}`
    });

    res.json({
      success: true,
      message: `Balance updated successfully`,
      newBalance: targetUser.balance,
      user: {
        id: targetUser._id,
        username: targetUser.username,
        balance: targetUser.balance,
        phone: targetUser.phone
      }
    });

  } catch (error) {
    console.error('Admin balance update error:', error);
    res.status(500).json({ error: error.message || 'Failed to update balance' });
  }
});

// GET: Visitor Analytics for SuperAdmin Dashboard
app.get('/api/admin/visitor-analytics', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const lookupResult = await smartUserLookup(req.user.userId, req.user.username, 'admin-visitor-analytics');
    const adminUser = lookupResult.success ? lookupResult.user : null;

    if (!adminUser || adminUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied. Super Admin role required.' });
    }

    // Get all visitors from last 48 hours (TTL handles cleanup)
    // Get latest visitors (limit 500 for performance)
    const visitors = await VisitorAnalytics.find({})
      .sort({ lastActivity: -1 })
      .limit(500);

    const totalVisitors = visitors.length;
    const authenticatedVisitors = visitors.filter(v => v.isAuthenticated).length;
    const anonymousVisitors = totalVisitors - authenticatedVisitors;
    const returningVisitors = visitors.filter(v => v.isReturning).length;

    // Top visitors by page views
    const topVisitors = visitors
      .filter(v => v.isAuthenticated)
      .sort((a, b) => b.pageViews - a.pageViews)
      .slice(0, 10)
      .map(v => ({
        username: v.username,
        userId: v.userId,
        pageViews: v.pageViews,
        lastActivity: v.lastActivity,
        isReturning: v.isReturning
      }));

    // Per-user visit frequency (group by userId)
    const userVisits = {};
    visitors.filter(v => v.userId).forEach(v => {
      const uid = v.userId.toString();
      if (!userVisits[uid]) {
        userVisits[uid] = {
          username: v.username,
          sessions: 0,
          totalPageViews: 0,
          lastVisit: v.lastActivity
        };
      }
      userVisits[uid].sessions += 1;
      userVisits[uid].totalPageViews += v.pageViews;
      if (new Date(v.lastActivity) > new Date(userVisits[uid].lastVisit)) {
        userVisits[uid].lastVisit = v.lastActivity;
      }
    });

    const perUserFrequency = Object.values(userVisits)
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 10);

    res.json({
      success: true,
      analytics: {
        totalVisitors,
        authenticatedVisitors,
        anonymousVisitors,
        returningVisitors,
        topVisitors,
        perUserFrequency,
        timeWindow: '48 hours'
      }
    });

  } catch (error) {
    console.error('Visitor analytics error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch visitor analytics' });
  }
});

// GET: Referral Leaderboard for SuperAdmin
app.get('/api/admin/referral-leaderboard', authenticateToken, async (req, res) => {
  try {
    const lookupResult = await smartUserLookup(req.user.userId, req.user.username, 'admin-referral-leaderboard');
    const adminUser = lookupResult.success ? lookupResult.user : null;

    if (!adminUser || adminUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied. Super Admin role required.' });
    }

    // Find all users who have referred someone (referredUsers array not empty)
    const referrers = await User.find({
      referredUsers: { $exists: true, $not: { $size: 0 } }
    })
      .select('_id username phone referralCode referralEarnings referredUsers')
      .lean();

    // For each referrer, populate their referred users' details
    const leaderboard = await Promise.all(
      referrers.map(async (referrer) => {
        // Fetch full details of referred users
        const referredUsersDetails = await User.find({
          _id: { $in: referrer.referredUsers }
        })
          .select('_id username phone stats balance createdAt')
          .lean();

        // Calculate active vs inactive referrals
        const activeReferrals = referredUsersDetails.filter(
          u => (u.stats?.gamesPlayed || 0) > 0
        ).length;

        const inactiveReferrals = referredUsersDetails.length - activeReferrals;

        return {
          referrer: {
            id: referrer._id,
            username: referrer.username,
            phone: referrer.phone,
            referralCode: referrer.referralCode,
            referralEarnings: referrer.referralEarnings || 0
          },
          totalReferrals: referredUsersDetails.length,
          activeReferrals,
          inactiveReferrals,
          referredUsers: referredUsersDetails.map(u => ({
            id: u._id,
            username: u.username,
            phone: u.phone,
            stats: {
              gamesPlayed: u.stats?.gamesPlayed || 0,
              wins: u.stats?.wins || u.stats?.gamesWon || 0
            },
            balance: u.balance || 0,
            createdAt: u.createdAt
          }))
        };
      })
    );

    // Sort by total referral earnings (descending)
    leaderboard.sort((a, b) => b.referrer.referralEarnings - a.referrer.referralEarnings);

    res.json({
      success: true,
      leaderboard
    });

  } catch (error) {
    console.error('Referral leaderboard error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch referral leaderboard' });
  }
});

// Initialize cache for performance optimization
// const NodeCache = require('node-cache'); // Already required at top
const cache = new NodeCache({
  stdTTL: 300, // 5 minutes default TTL
  checkperiod: 60 // Check for expired keys every 60 seconds
});

app.get('/api/users/leaderboard', async (req, res) => {
  try {
    // Fetch top 3 users sorted by wins (descending)
    // We use 'stats.gamesWon' as the primary sort key
    const topPlayers = await User.find({
      'stats.gamesWon': { $gt: 0 } // Only include players who have won at least one game
    })
      .sort({ 'stats.gamesWon': -1 })
      .limit(3)
      .select('username avatar stats.gamesWon'); // Select only necessary fields

    // Map to the format expected by the frontend
    const leaderboard = topPlayers.map(user => ({
      id: user._id,
      username: user.username,
      avatar: user.avatar, // Use database value, don't override with hardcoded URL
      wins: user.stats?.gamesWon || 0
    }));

    res.json({
      success: true,
      leaderboard
    });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ success: false, leaderboard: [], error: error.message });
  }
});

// POST: Rejoin an active game
app.post('/api/game/rejoin', async (req, res) => {
  try {
    const { gameId, userId, userName } = req.body;

    if (!gameId || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Game ID and User ID are required'
      });
    }

    console.log(`🔄 Rejoin request: gameId=${gameId}, userId=${userId}, userName=${userName}`);

    // Find the game
    const game = await Game.findOne({ gameId });

    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    if (game.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        message: `Game is ${game.status}, cannot rejoin`
      });
    }

    // Find the player in the game
    const playerIndex = game.players.findIndex(p => String(p.userId) === String(userId));

    if (playerIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'You are not a player in this game'
      });
    }

    const player = game.players[playerIndex];

    // Check if player already won
    if (game.winners.includes(player.color)) {
      return res.json({
        success: true,
        gameId: game.gameId,
        playerColor: player.color,
        allPawnsHome: true,
        canRejoin: false,
        message: 'You have already won this game'
      });
    }

    // Update player's username if provided (for display sync)
    if (userName && player.username !== userName) {
      player.username = userName;
      await game.save();
      console.log(`✅ Updated username for player ${player.color} to ${userName}`);
    }

    console.log(`✅ Rejoin successful for user ${userId} as ${player.color} in game ${gameId}`);

    res.json({
      success: true,
      gameId: game.gameId,
      playerColor: player.color,
      allPawnsHome: false,
      canRejoin: true,
      message: 'Rejoin successful - reconnect via socket'
    });
  } catch (error) {
    console.error('Error rejoining game:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to rejoin game'
    });
  }
});

// GET: Admin - Get Revenue Stats
app.get('/api/admin/revenue', authenticateToken, async (req, res) => {
  try {
    const lookupResult = await smartUserLookup(req.user.userId, req.user.username, 'admin-revenue');
    let adminUser = lookupResult.success ? lookupResult.user : null;

    if (!adminUser || adminUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: "Access denied" });
    }

    // Get filter parameter from query string
    const filter = req.query.filter || 'all'; // all, today, yesterday, thisWeek, last15Days, last30Days

    // Calculate date range based on filter
    let startDate = null;
    let endDate = null;
    const now = new Date();

    switch (filter) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        break;
      case 'yesterday':
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        startDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(yesterday);
        endDate.setHours(23, 59, 59, 999);
        break;
      case 'thisWeek':
        const dayOfWeek = now.getDay();
        const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Monday
        startDate = new Date(now.getFullYear(), now.getMonth(), diff);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        break;
      case 'last15Days':
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 15);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        break;
      case 'last30Days':
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 30);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        break;
      default:
        startDate = null; // All time
        endDate = null;
    }

    // Build query
    let query = { amount: { $gt: 0 } };
    if (startDate && endDate) {
      query.timestamp = { $gte: startDate, $lte: endDate };
    } else if (startDate) {
      query.timestamp = { $gte: startDate };
    }

    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const totalRevenues = await Revenue.countDocuments(query);
    const totalPages = Math.ceil(totalRevenues / limit);

    const revenues = await Revenue.find(query)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);

    // Enrich revenues with game details
    const enrichedRevenues = await Promise.all(revenues.map(async (rev) => {
      let playersInfo = [];
      let winnerInfo = null;
      let stake = 0;

      // FIX: Prioritize existing gameDetails if available (valid for newer records)
      // Since Games are deleted after completion, looking them up often returns null.
      if (rev.gameDetails && rev.gameDetails.players && rev.gameDetails.players.length > 0) {
        playersInfo = rev.gameDetails.players;
        winnerInfo = rev.gameDetails.winner;
        stake = rev.gameDetails.stake || 0;
      } else {
        // Fallback: Try to find Game (legacy support or if details missing)
        let game = null;
        try {
          game = await Game.findOne({ gameId: rev.gameId });
        } catch (e) { /* ignore error */ }

        if (game) {
          playersInfo = game.players.map(p => ({
            userId: p.userId,
            username: p.username,
            color: p.color
          }));
          const w = game.players.find(p => p.userId === rev.winnerId || p.color === game.winners?.[0]);
          if (w) {
            winnerInfo = {
              userId: rev.winnerId,
              username: w.username || w.userId,
              color: w.color
            };
          }
          stake = game.stake;
        } else {
          // Second Fallback: Try to look up User names directly if we have IDs in the revenue record (unlikely if not in gameDetails, but good for robustness)
          // For now, if no game details, we just return basic info preventing crash
          winnerInfo = { userId: rev.winnerId, username: 'Unknown (Purged)', color: 'gray' };
          // Use placeholders
          playersInfo = [{ username: 'Details Purged', color: 'gray' }];
        }
      }

      return {
        _id: rev._id,
        gameId: rev.gameId,
        amount: rev.amount,
        gemRevenue: 0,
        totalPot: rev.totalPot,
        winnerId: rev.winnerId,
        timestamp: rev.timestamp,
        reason: rev.reason,
        gameDetails: {
          players: playersInfo,
          winner: winnerInfo,
          stake: stake || (rev.totalPot / 2),
          gameId: rev.gameId
        }
      };

    }));

    const withdrawals = await RevenueWithdrawal.find(query).sort({ timestamp: -1 });

    const totalRevenue = await Revenue.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalRevenueAmount = totalRevenue.length > 0 ? totalRevenue[0].total : 0;

    const totalWithdrawnAmount = withdrawals.reduce((sum, wd) => sum + wd.amount, 0);
    const netRevenue = totalRevenueAmount - totalWithdrawnAmount;

    res.json({
      success: true,
      totalRevenue: totalRevenueAmount,
      totalWithdrawn: totalWithdrawnAmount,
      netRevenue,
      history: enrichedRevenues, // <--- Send the enriched revenues
      withdrawals: withdrawals,
      filter: filter,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalItems: totalRevenues,
        limit: limit
      }
    });
  } catch (e) {
    console.error("Revenue Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// POST: Admin - Withdraw Revenue
app.post('/api/admin/revenue/withdraw', authenticateToken, async (req, res) => {
  try {
    console.log('💸 Withdrawal request received:', req.body);
    const { amount, destination, reference } = req.body;

    // 1. Authorization Check
    const lookupResult = await smartUserLookup(req.user.userId, req.user.username, 'admin-withdraw');
    let adminUser = lookupResult.success ? lookupResult.user : null;

    if (!adminUser || adminUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: "Access denied" });
    }

    // 2. Validation
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }
    if (!destination) {
      return res.status(400).json({ error: "Destination required" });
    }

    // 3. Check Balance (Calculate Net Revenue)
    const revenues = await Revenue.find({});
    const withdrawals = await RevenueWithdrawal.find({});

    const totalRevenue = revenues.reduce((sum, rev) => sum + rev.amount, 0);
    const totalWithdrawn = withdrawals.reduce((sum, wd) => sum + wd.amount, 0);
    const netRevenue = totalRevenue - totalWithdrawn;

    if (amount > netRevenue) {
      return res.status(400).json({ error: `Insufficient funds. Available: $${netRevenue.toFixed(2)}` });
    }

    // 4. Process Withdrawal
    const withdrawal = new RevenueWithdrawal({
      amount,
      destination,
      reference: reference || `Withdrawal by ${adminUser.username}`,
      adminId: adminUser._id,
      adminName: adminUser.username
    });

    await withdrawal.save();
    console.log(`💸 Revenue withdrawal: $${amount} by ${adminUser.username}`);

    res.json({
      success: true,
      message: "Withdrawal successful",
      withdrawal
    });

  } catch (e) {
    console.error("Withdrawal Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// ACCOUNTING ROUTES (SUPER_ADMIN only)
// ============================================================

// GET: All expenses (with optional month filter)
app.get('/api/admin/expenses', authenticateToken, async (req, res) => {
  try {
    const adminUser = await User.findById(req.user.userId);
    if (!adminUser || adminUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied. Super Admin only.' });
    }
    const { month } = req.query; // e.g. "2026-04"
    let query = {};
    if (month) {
      const start = new Date(`${month}-01T00:00:00.000Z`);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      query.paidAt = { $gte: start, $lt: end };
    }
    const expenses = await Expense.find(query).sort({ paidAt: -1 });
    res.json({ success: true, expenses });
  } catch (e) {
    console.error('GET expenses error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST: Create a new expense
app.post('/api/admin/expenses', authenticateToken, async (req, res) => {
  try {
    const adminUser = await User.findById(req.user.userId);
    if (!adminUser || adminUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied. Super Admin only.' });
    }
    const { name, category, amount, recurrence, paidAt, note } = req.body;
    if (!name || !amount || amount <= 0) {
      return res.status(400).json({ error: 'Name and a positive amount are required.' });
    }
    const expense = new Expense({
      name,
      category: category || 'other',
      amount,
      recurrence: recurrence || 'monthly',
      paidAt: paidAt ? new Date(paidAt) : new Date(),
      note: note || '',
      createdBy: adminUser._id
    });
    await expense.save();
    console.log(`💸 Expense added: ${name} $${amount} by ${adminUser.username}`);
    res.json({ success: true, expense });
  } catch (e) {
    console.error('POST expense error:', e);
    res.status(500).json({ error: e.message });
  }
});

// PUT: Update an expense
app.put('/api/admin/expenses/:id', authenticateToken, async (req, res) => {
  try {
    const adminUser = await User.findById(req.user.userId);
    if (!adminUser || adminUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied. Super Admin only.' });
    }
    const expense = await Expense.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: new Date() },
      { new: true, runValidators: true }
    );
    if (!expense) return res.status(404).json({ error: 'Expense not found.' });
    res.json({ success: true, expense });
  } catch (e) {
    console.error('PUT expense error:', e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE: Remove an expense
app.delete('/api/admin/expenses/:id', authenticateToken, async (req, res) => {
  try {
    const adminUser = await User.findById(req.user.userId);
    if (!adminUser || adminUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied. Super Admin only.' });
    }
    const expense = await Expense.findByIdAndDelete(req.params.id);
    if (!expense) return res.status(404).json({ error: 'Expense not found.' });
    res.json({ success: true, message: 'Expense deleted.' });
  } catch (e) {
    console.error('DELETE expense error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET: Accounting summary - income vs expenses for a given month
app.get('/api/admin/accounting/summary', authenticateToken, async (req, res) => {
  try {
    const adminUser = await User.findById(req.user.userId);
    if (!adminUser || adminUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied. Super Admin only.' });
    }
    const { month } = req.query; // e.g. "2026-04"
    let matchQuery = {};
    if (month) {
      const start = new Date(`${month}-01T00:00:00.000Z`);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      matchQuery.timestamp = { $gte: start, $lt: end };
    }

    // Income: game rake only (gems are excluded from platform earnings)
    const incomeAgg = await Revenue.aggregate([
      { $match: matchQuery },
      { $group: { _id: null, gameRake: { $sum: '$amount' } } }
    ]);
    const gameRake = incomeAgg[0]?.gameRake || 0;
    const gemRevenue = 0;
    const totalIncome = gameRake;

    // Expenses for the month
    let expQuery = {};
    if (month) {
      const start = new Date(`${month}-01T00:00:00.000Z`);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      expQuery.paidAt = { $gte: start, $lt: end };
    }
    const expenses = await Expense.find(expQuery).sort({ paidAt: -1 });
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const netProfit = totalIncome - totalExpenses;

    // Breakdown by category
    const byCategory = {};
    expenses.forEach(e => {
      byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
    });

    // 1. ALL APPROVED FINANCIAL REQUESTS (Deposits - Withdrawals)
    let frMatchQuery = { status: 'APPROVED' };
    if (month) {
      const start = new Date(`${month}-01T00:00:00.000Z`);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      frMatchQuery.timestamp = { $gte: start, $lt: end };
    }
    const approvedFrAgg = await FinancialRequest.aggregate([
      { $match: frMatchQuery },
      { $group: { 
          _id: null, 
          net: { 
            $sum: { 
              $cond: [
                { $eq: ['$type', 'DEPOSIT'] }, 
                '$amount', 
                { $multiply: ['$amount', -1] } // Subtract if WITHDRAWAL
              ] 
            } 
          } 
      } }
    ]);
    const totalFrNet = approvedFrAgg[0]?.net || 0;

    // 2. COMPREHENSIVE DB-LEVEL AGGREGATION FOR ALL USER TRANSACTIONS (Net: Deposits - Withdrawals)
    const txAggregation = await User.aggregate([
      { $unwind: '$transactions' },
      { 
        $addFields: {
          txMonth: { $dateToString: { format: "%Y-%m", date: { $ifNull: [ "$transactions.timestamp", "$transactions.createdAt", "$$NOW" ] } } }
        } 
      },
      {
        $match: {
          ...(month ? { txMonth: month } : {}),
          "transactions.type": { $in: ['deposit', 'admin_deposit', 'withdrawal', 'admin_withdrawal', 'loan_repayment', 'loan_auto_repayment', 'loan_settlement'] }
        }
      },
      {
        $group: {
          _id: null,
          netWallet: {
            $sum: {
              $cond: [
                { $in: ["$transactions.type", ['deposit', 'admin_deposit']] },
                "$transactions.amount",
                { $multiply: ["$transactions.amount", -1] } // Subtract if withdrawal
              ]
            }
          }
        }
      }
    ]);

    const walletFromTxs = txAggregation[0]?.netWallet || 0;
    const gemsFromTxs = 0;

    const evcPlayerNet = totalFrNet + walletFromTxs;
    const gemDeposits = gemsFromTxs;
    const totalEVCReceived = evcPlayerNet + gemDeposits;

    // ACTUAL DATABASE TOTALS (Liability check)
    // Using a more robust aggregation that handles potential nulls/missing fields
    const liabilityAgg = await User.aggregate([
      { 
        $group: { 
          _id: null, 
          total: { 
            $sum: { 
              $add: [
                { $ifNull: ["$balance", 0] }, 
                { $ifNull: ["$reservedBalance", 0] }
              ] 
            } 
          } 
        } 
      }
    ]);
    const actualLiability = liabilityAgg.length > 0 ? (liabilityAgg[0].total || 0) : 0;

    // FETCH MANUAL ADJUSTMENTS (We will create this model below)
    let manualAdjustment = 0;
    try {
      const Adjustment = mongoose.model('AccountingAdjustment');
      const adjResult = await Adjustment.aggregate([
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ]);
      manualAdjustment = adjResult[0]?.total || 0;
    } catch (e) {
      // Model might not exist yet on first run
    }

    const totalEVCWithAdj = totalEVCReceived + manualAdjustment;

    console.log(`📊 ACC SUMMARY: Month=${month || 'all'}, Net Inflow=${totalEVCReceived}, Adj=${manualAdjustment}, Real Liability=${actualLiability}`);

    const evcTracking = { 
      playerDeposits: evcPlayerNet,
      actualLiability: actualLiability,
      gemDeposits: gemDeposits, 
      totalEvcReceived: totalEVCWithAdj,
      manualAdjustment: manualAdjustment
    };

    res.json({
      success: true,
      month: month || 'all-time',
      income: { gameRake, gemRevenue, total: totalIncome },
      evcTracking, // Pass the already defined evcTracking object correctly
      expenses: { items: expenses, total: totalExpenses, byCategory },
      netProfit
    });
  } catch (e) {
    console.error('Accounting summary error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 5. MANUAL ACCOUNTING ADJUSTMENT
app.post('/api/admin/accounting/adjust', authenticateToken, async (req, res) => {
  try {
    const adminUser = await User.findById(req.user.userId);
    if (!adminUser || adminUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied. Super Admin only.' });
    }

    const { amount, reason } = req.body;
    
    if (amount === undefined || !reason) {
      return res.status(400).json({ error: 'Amount and reason are required' });
    }

    const adjustment = new AccountingAdjustment({
      amount: parseFloat(amount),
      reason,
      adminId: req.user.userId,
      adminUsername: adminUser.username || 'Admin'
    });

    await adjustment.save();

    res.json({ success: true, message: 'Adjustment saved successfully' });
  } catch (error) {
    console.error('Accounting adjustment error:', error);
    res.status(500).json({ error: 'Failed to save adjustment' });
  }
});

// ============================================================
// CASH LOG ROUTES (SUPER_ADMIN only)
// ============================================================

// GET: All cash logs (filter by type, month)
app.get('/api/admin/cash-logs', authenticateToken, async (req, res) => {
  try {
    const adminUser = await User.findById(req.user.userId);
    if (!adminUser || adminUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied. Super Admin only.' });
    }
    const { month, type } = req.query;
    let query = {};
    if (month) {
      const start = new Date(`${month}-01T00:00:00.000Z`);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      query.createdAt = { $gte: start, $lt: end };
    }
    if (type) {
      query.type = type;
    }
    const cashLogs = await CashLog.find(query).sort({ createdAt: -1 });
    
    // Calculate totals
    const totals = await CashLog.aggregate([
      { $match: query },
      { $group: { _id: '$type', totalAmount: { $sum: '$amount' } } }
    ]);
    
    const summary = {
      evc_received: totals.find(t => t._id === 'evc_received')?.totalAmount || 0,
      bank_deposit: totals.find(t => t._id === 'bank_deposit')?.totalAmount || 0
    };

    res.json({ success: true, cashLogs, summary });
  } catch (e) {
    console.error('GET cash-logs error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST: Create a new cash log
app.post('/api/admin/cash-logs', authenticateToken, async (req, res) => {
  try {
    const adminUser = await User.findById(req.user.userId);
    if (!adminUser || adminUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied. Super Admin only.' });
    }
    
    const { type, amount, note, createdAt } = req.body;
    
    if (!type || !['evc_received', 'bank_deposit'].includes(type)) {
      return res.status(400).json({ error: 'Valid type (evc_received, bank_deposit) is required.' });
    }
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'A positive amount is required.' });
    }
    
    const cashLog = new CashLog({
      type,
      amount,
      note: note || '',
      createdBy: adminUser._id,
      createdAt: createdAt ? new Date(createdAt) : new Date()
    });
    
    await cashLog.save();
    console.log(`💵 CashLog added: [${type}] $${amount} by ${adminUser.username}`);
    res.json({ success: true, cashLog });
  } catch (e) {
    console.error('POST cash-log error:', e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE: Remove a cash log
app.delete('/api/admin/cash-logs/:id', authenticateToken, async (req, res) => {
  try {
    const adminUser = await User.findById(req.user.userId);
    if (!adminUser || adminUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied. Super Admin only.' });
    }
    
    const cashLog = await CashLog.findByIdAndDelete(req.params.id);
    if (!cashLog) return res.status(404).json({ error: 'Cash log not found.' });
    
    res.json({ success: true, message: 'Cash log deleted.' });
  } catch (e) {
    console.error('DELETE cash-log error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST: Admin - Directly update user balance (Deposit/Withdrawal by Super Admin)
app.post('/api/admin/user/balance-update', authenticateToken, async (req, res) => {
  try {
    const { userId, amount, type, comment } = req.body;

    // 1. Authorization Check (Super Admin only)
    const lookupResult = await smartUserLookup(req.user.userId, req.user.username, 'admin-direct-balance-update');
    const adminUser = lookupResult.success ? lookupResult.user : null;

    if (!adminUser || adminUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: "Access denied. Super Admin role required." });
    }

    // 2. Input Validation
    // Convert type to uppercase for consistent validation
    const normalizedType = type?.toUpperCase();

    if (!userId || !amount || amount <= 0 || !normalizedType || !['DEPOSIT', 'WITHDRAWAL'].includes(normalizedType)) {
      return res.status(400).json({ error: 'User ID, valid amount, and type (DEPOSIT/WITHDRAWAL) are required.' });
    }

    // 3. Find User
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    let newBalance = user.balance;
    let transactionType = '';
    let transactionDescription = '';

    if (normalizedType === 'DEPOSIT') {
      newBalance = roundCurrency(newBalance + amount);
      transactionType = 'deposit';
      transactionDescription = comment || `Admin deposit by ${adminUser.username}`;
    } else { // WITHDRAWAL
      if (user.balance < amount) {
        return res.status(400).json({ error: `Insufficient funds. User balance: $${user.balance}, requested withdrawal: $${amount}.` });
      }
      newBalance = roundCurrency(newBalance - amount);
      transactionType = 'withdrawal';
      transactionDescription = comment || `Admin withdrawal by ${adminUser.username}`;
    }

    // 4. Update User Balance and Log Transaction
    user.balance = roundCurrency(newBalance);
    // AUTO LOAN SETTLEMENT (only if it was a deposit)
    if (normalizedType === 'DEPOSIT') {
      await autoSettleLoansOnDeposit(user, 'direct admin balance update');
    }

    user.transactions.push({
      type: transactionType,
      amount: normalizedType === 'DEPOSIT' ? amount : -amount, // Store withdrawals as negative amounts
      matchId: null, // No game associated
      description: transactionDescription,
      createdAt: new Date()
    });
    await user.save();

    console.log(`💰 Super Admin ${adminUser.username} performed ${normalizedType} of $${amount} for user ${user.username} (ID: ${user._id}). New balance: $${user.balance}`);

    // Emit real-time balance update to player
    io.to(`user_${user._id}`).emit('balance_updated', {
      newBalance: user.balance,
      type: normalizedType,
      amount: amount,
      message: transactionDescription
    });

    res.json({
      success: true,
      message: `User ${user.username}'s balance updated successfully (${normalizedType}: $${amount}). New balance: $${user.balance}.`,
      user: {
        id: user._id,
        username: user.username,
        balance: user.balance
      }
    });

  } catch (e) {
    console.error('Error during admin direct balance update:', e);
    res.status(500).json({ error: e.message || 'Failed to update user balance directly.' });
  }
});

// GET: Admin - Get Active Games
app.get('/api/admin/games/active', authenticateToken, async (req, res) => {
  try {
    const lookupResult = await smartUserLookup(req.user.userId, req.user.username, 'admin-active-games');
    let adminUser = lookupResult.success ? lookupResult.user : null;

    if (!adminUser || (adminUser.role !== 'SUPER_ADMIN' && adminUser.role !== 'ADMIN')) {
      return res.status(403).json({ error: "Access denied" });
    }

    const activeGames = await Game.find({ status: 'ACTIVE' }).sort({ createdAt: -1 });
    res.json({ success: true, games: activeGames });
  } catch (e) {
    console.error("Active Games Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// POST: Admin - Force players to be able to rejoin (invite them)
app.post('/api/admin/games/force-rejoin/:gameId', authenticateToken, async (req, res) => {
  try {
    const lookupResult = await smartUserLookup(req.user.userId, req.user.username, 'admin-force-rejoin');
    const adminUser = lookupResult.success ? lookupResult.user : null;
    if (!adminUser || adminUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { gameId } = req.params;
    if (!gameId) return res.status(400).json({ error: 'Game ID required' });

    const Game = require('./models/Game');
    const game = await Game.findOne({ gameId });
    if (!game) return res.status(404).json({ error: 'Game not found' });

    // Mark players as rejoin-invited by clearing disconnected flags so checkActiveGame will show them
    let changed = false;
    game.players.forEach(player => {
      if (!player.isAI && player.isDisconnected) {
        player.isDisconnected = false;
        changed = true;
      }
    });

    // Add a short admin message
    game.message = (game.message || '') + ' | Admin invited players to rejoin';
    if (changed) await game.save();

    const plainState = game.toObject ? game.toObject() : game;

    // Emit state update to the game room so connected clients refresh
    if (global.io || io) {
      (global.io || io).to(gameId).emit('GAME_STATE_UPDATE', { state: plainState });
    }

    // Emit FORCE_REJOIN_INVITE to each player's personal user room
    // This ensures disconnected players receive the notification even if not in the game room
    const ioInstance = global.io || io;
    if (ioInstance) {
      for (const player of game.players) {
        if (!player.isAI && player.userId) {
          const userRoom = `user_${player.userId}`;
          console.log(`📢 Sending FORCE_REJOIN_INVITE to user room: ${userRoom} for game ${gameId}`);
          ioInstance.to(userRoom).emit('FORCE_REJOIN_INVITE', {
            gameId: game.gameId,
            playerColor: player.color,
            message: 'Admin invited you to rejoin the game. Refreshing...'
          });
        }
      }
    }

    res.json({ success: true, game: plainState });
  } catch (e) {
    console.error('Force rejoin error:', e);
    res.status(500).json({ error: e.message || 'Failed to force rejoin' });
  }
});

// POST: Admin - Cancel and Refund an Active Game
app.post('/api/admin/games/:gameId/refund', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { gameId } = req.params;
    if (!gameId) {
      return res.status(400).json({ error: 'Game ID is required' });
    }

    // 2. Find the Game
    const game = await Game.findOne({ gameId });
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // 3. Validate Game Status
    if (game.status !== 'ACTIVE') {
      return res.status(400).json({ error: `Game is not ACTIVE (current status: ${game.status}). Cannot refund.` });
    }

    const stake = game.stake || 0;
    if (stake <= 0) {
      return res.status(400).json({ error: 'Game has no stake to refund.' });
    }

    // 4. Process Refunds for all human players
    for (const player of game.players) {
      if (player.userId && !player.isAI) {
        const user = await User.findById(player.userId);
        if (user) {
          // Move stake from reserved back to main balance
          user.balance = roundCurrency(user.balance + stake);
          user.reservedBalance = roundCurrency(Math.max(0, user.reservedBalance - stake));

          // Add a clear transaction log
          user.transactions.push({
            type: 'game_refund',
            amount: stake,
            matchId: game.gameId,
            description: `Refund for game ${game.gameId} cancelled by admin`
          });
          await user.save();
          console.log(`💰 Refunded $${stake} to ${user.username} for cancelled game ${game.gameId}`);
        }
      }
    }

    // 5. Update Game Status to CANCELLED
    game.status = 'CANCELLED';
    game.message = `Game cancelled by administrator. Stakes have been refunded.`;
    await game.save();

    // 6. Notify players in real-time
    io.to(gameId).emit('ERROR', { message: 'Game was cancelled by an administrator. Your stake has been refunded.' });

    res.json({ success: true, message: `Game ${gameId} has been cancelled and stakes refunded.` });
  } catch (error) {
    console.error('Admin refund game error:', error);
    res.status(500).json({ error: error.message || 'Failed to refund game.' });
  }
});

// DELETE: Admin - Remove specific game
app.delete('/api/admin/matches/:gameId', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { gameId } = req.params;
    console.log(`🗑️ Admin ${req.user.username} (Super Admin) deleting game ${gameId}`);

    const Game = require('./models/Game');
    const game = await Game.findOne({ gameId });

    if (!game) return res.status(404).json({ error: 'Game not found' });

    // Refund if active/waiting
    if (game.status === 'ACTIVE' || game.status === 'WAITING') {
      for (const player of game.players) {
        if (player.userId && !player.isAI) {
          const user = await User.findById(player.userId);
          if (user) {
            user.balance = roundCurrency(user.balance + (game.stake || 0));
            await user.save();
            console.log(`💰 Refunded ${game.stake} to ${user.username} due to admin deletion`);
          }
        }
      }
    }

    await Game.deleteOne({ gameId });
    // Notify players if io is available (it is globally in this file)
    if (global.io || io) {
      (global.io || io).to(gameId).emit('ERROR', { message: 'Game was cancelled by administrator' });
    }

    res.json({ message: 'Game removed successfully' });
  } catch (error) {
    console.error('Delete game error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST: Admin - DELETE ALL ACTIVE GAMES ONLY
app.post('/api/admin/games/delete-active', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    console.log(`🗑️ Admin ${req.user.username} deleting all active games...`);
    const activeResult = await Game.deleteMany({ status: 'ACTIVE' });

    // Also clear matchmaking queue in memory
    matchmakingQueue.clear();

    console.log(`✅ Deleted ${activeResult.deletedCount} active games.`);

    res.json({
      success: true,
      message: `Deleted ${activeResult.deletedCount} active games.`,
      deleted: {
        active: activeResult.deletedCount
      }
    });
  } catch (e) {
    console.error("Delete Active Games Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// POST: Admin - DELETE ALL GAMES (Cleanup)
app.post('/api/admin/games/cleanup', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    console.log(`🗑️ Admin ${req.user.username} initiating global game cleanup...`);
    const activeResult = await Game.deleteMany({ status: 'ACTIVE' });
    const waitingResult = await Game.deleteMany({ status: 'WAITING' });

    // Also clear matchmaking queue in memory
    matchmakingQueue.clear();

    console.log(`✅ Cleanup complete: Deleted ${activeResult.deletedCount} active and ${waitingResult.deletedCount} waiting games.`);

    res.json({
      success: true,
      message: `Deleted ${activeResult.deletedCount} active and ${waitingResult.deletedCount} waiting games.`,
      deleted: {
        active: activeResult.deletedCount,
        waiting: waitingResult.deletedCount
      }
    });
  } catch (e) {
    console.error("Cleanup Games Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// GET: Admin - Get User Details with History
app.get('/api/admin/user/:userId/details', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Find completed games where this user participated
    // Accept either string or ObjectId forms for player.userId to avoid mismatches
    const mongoose = require('mongoose');
    let userObjectId = null;
    try {
      userObjectId = mongoose.Types.ObjectId(userId);
    } catch (err) {
      // invalid ObjectId, ignore
      userObjectId = null;
    }

    const matchQuery = {
      status: 'COMPLETED',
      $or: [
        { 'players.userId': userId }
      ]
    };
    if (userObjectId) {
      matchQuery.$or.push({ 'players.userId': userObjectId });
    }

    console.log('🔎 Admin user-details matchQuery:', JSON.stringify(matchQuery));
    const matchHistory = await Game.find(matchQuery).sort({ updatedAt: -1 }).limit(50);
    console.log(`🔎 Found ${matchHistory.length} completed games for user ${userId}`);
    if (matchHistory.length > 0) {
      try {
        console.log('🔎 Sample game players for first matched game:', matchHistory[0].players);
      } catch (err) {
        // ignore serialization issues
      }
    }

    // Format history
    const history = matchHistory.map(game => {
      // Find this user's player record in the game
      // FIX loose equality or string casting to ensure match
      const userPlayer = game.players.find(p => String(p.userId) === String(userId));

      if (!userPlayer) {
        console.warn(`⚠️ History mismatch: User ${userId} found in Game query but not in players array for game ${game.gameId}`);
        return null; // Skip if player not found
      }

      // Check if this user's color is in the winners array
      const isWinner = game.winners && game.winners.includes(userPlayer.color);

      // Find the opponent (the other player in the game)
      const opponent = game.players.find(p => p.userId !== userId);

      // Calculate amount won/lost
      // If winner: Won (Pot - Commission) which is stake * 2 * 0.9 = stake * 1.8
      // But user also gets their stake back, so net win is stake * 0.8
      // If loser: Lost their stake
      let amount = 0;
      if (isWinner) {
        // Winner gets 90% of pot (stake * 2 * 0.9) - stake = stake * 0.8
        // User requested to show NET PROFIT (e.g. 0.20) rather than Total Payout (0.45)
        amount = (game.stake || 0) * 0.8;
      } else {
        // Loser loses their stake
        amount = -(game.stake || 0);
      }

      return {
        gameId: game.gameId,
        date: game.updatedAt || game.createdAt,
        opponentName: opponent?.username || opponent?.color || 'Unknown',
        result: isWinner ? 'WON' : 'LOST',
        amount: amount,
        stake: game.stake || 0
      };
    }).filter(h => h !== null); // Remove null entries

    res.json({
      success: true,
      user: {
        id: targetUser._id,
        username: targetUser.username,
        stats: targetUser.stats,
        balance: targetUser.balance
      },
      history,
      transactions: targetUser.transactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    });

  } catch (e) {
    console.error("User Details Error:", e);
    res.status(500).json({ error: e.message });
  }
});


// ===== GEMS API ROUTES =====
app.post('/api/admin/deposit-gems', authenticateToken, authorizeAdmin, async (req, res) => {
  console.log(`💎 API HIT: /api/admin/deposit-gems [POST]`); // DEBUG LOG

  try {
    const { userId, gemAmount, comment } = req.body;
    const adminUser = req.user;

    if (!userId || !gemAmount || gemAmount <= 0) {
      return res.status(400).json({ error: 'User ID and valid gem amount required' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const gemsToAdd = parseInt(gemAmount);
    // SAFELY handle undefined gems for legacy users
    // Ensure gems is initialized to 0 if undefined to prevent NaN issues
    if (user.gems === undefined || user.gems === null || isNaN(user.gems)) {
      user.gems = 0;
    }

    // Safety check for balance too
    if (user.balance === undefined || user.balance === null || isNaN(user.balance)) {
      user.balance = 0;
    }

    user.gems += gemsToAdd;

    user.transactions.push({
      type: 'gem_purchase',
      amount: gemsToAdd,
      description: comment || `Admin ${adminUser.username} deposited ${gemsToAdd} gems`,
      createdAt: new Date()
    });

    await user.save();

    // --> NEW REVENUE RECORD FOR ADMIN GEM DEPOSIT <--
    const Revenue = require('./models/Revenue');
    const dollarValue = gemsToAdd * 0.01; // 10 gems = $0.10
    const gemRevenueRecord = new Revenue({
      gameId: 'ADMIN_STORE',
      gameType: 'LUDO', 
      amount: 0,
      gemRevenue: dollarValue,
      totalPot: 0,
      winnerId: user._id.toString(), // FIX: Must be String, not ObjectId
      reason: 'Admin Gem Deposit',
      timestamp: new Date()
    });
    await gemRevenueRecord.save();

    console.log(`✅ Admin ${adminUser.username} deposited ${gemsToAdd} gems to ${user.username}. Revenue logged: $${dollarValue.toFixed(2)}`);

    res.json({
      success: true,
      message: `Successfully deposited ${gemsToAdd} gems to ${user.username}`,
      newGemBalance: user.gems
    });

  } catch (error) {
    console.error('Gem deposit error:', error);
    res.status(500).json({ error: 'Failed to deposit gems' });
  }
});

app.get('/api/admin/gems/:userId', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const gemTransactions = user.transactions.filter(t =>
      t.type === 'gem_purchase' || t.type === 'gem_usage'
    ).slice(-20);

    res.json({
      username: user.username,
      gems: user.gems,
      transactions: gemTransactions
    });

  } catch (error) {
    console.error('Get gem balance error:', error);
    res.status(500).json({ error: 'Failed to fetch gem data' });
  }
});


// --- WALLET & PAYMENT ROUTES ---

// GET: User - Get My Requests
app.get('/api/wallet/my-requests', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const requests = await FinancialRequest.find({ userId }).sort({ timestamp: -1 });
    res.json({ success: true, requests });
  } catch (e) {
    console.error("Get My Requests Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// POST: User - Create a Request
app.post('/api/wallet/request', authenticateToken, async (req, res) => {
  // Use userId from token (more secure) or fallback to body
  const userId = req.user?.userId || req.body.userId;
  const { userName, type, amount, details, paymentMethod, paymentPin, pin } = req.body;
  const submittedPaymentPin = String(paymentPin || pin || '').trim();
  const isAutoCreditPinDeposit = type === 'DEPOSIT' && submittedPaymentPin.length > 0;

  if (!userId) {
    return res.status(400).json({ error: "User ID is required" });
  }

  try {
    if (!amount || amount <= 0) return res.status(400).json({ error: "Invalid amount" });
    if (type === 'DEPOSIT' && amount > 300) return res.status(400).json({ error: "Maximum deposit is $300" });

    // Smart user sync: Ensure user exists and prevent duplicate creation
    const syncResult = await smartUserSync(userId, userName, 'wallet-request');
    if (!syncResult.success) {
      return res.status(500).json({ error: "Failed to sync user account. Please try again." });
    }

    let user = syncResult.user;

    // Only enforce pending-request lock for manual requests.
    // PIN-verified deposits are auto-credited and should not be blocked.
    if (!isAutoCreditPinDeposit) {
      const pendingRequest = await FinancialRequest.findOne({
        userId: user._id,
        status: 'PENDING'
      });

      if (pendingRequest) {
        // Build a friendly Somali message including the user's first name when available
        const rawName = (user && (user.username || user.userName)) || userName || '';
        const firstName = rawName ? String(rawName).trim().split(/\s+/)[0] : '';
        const displayName = firstName || 'Saaxiib';
        const phone = '0610251014';
        const message = `Waanka xunnahay ${displayName} horey ayaad dalab u gudbisay, fadlan la xariir ${phone} si laguugu xaqiijiyo mahadsanid`;
        return res.status(400).json({ error: message });
      }
    }

    if (type === 'WITHDRAWAL') {
      // FIX: Use rounding to prevent floating point errors
      if (Math.round(user.balance * 100) < Math.round(amount * 100)) {
        return res.status(400).json({ error: "Insufficient funds" });
      }
      // Check for withdrawal limit (1 per 24h)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      // Temporarily disabled: 24-hour withdrawal restriction
      // const recentWithdrawal = await FinancialRequest.findOne({
      //     userId: user._id,
      //     type: 'WITHDRAWAL',
      //     timestamp: { $gt: oneDayAgo }
      // });

      // if (recentWithdrawal) {
      //     return res.status(400).json({ error: "You can only make one withdrawal request every 24 hours." });
      // }
    } else if (type === 'DEPOSIT') {
      // Check if deposit would exceed max balance
      if (user.balance + amount > 300) {
        return res.status(400).json({ error: `Maximum wallet balance is $300. Your current balance is $${user.balance}. Max deposit allowed is $${300 - user.balance}.` });
      }
    }

    // Calculate shortId
    const lastRequest = await FinancialRequest.findOne().sort({ shortId: -1 });
    const nextShortId = (lastRequest && lastRequest.shortId) ? lastRequest.shortId + 1 : 1;

    const newRequest = new FinancialRequest({
      userId: user._id,
      userName: user.username,
      shortId: nextShortId,
      type,
      amount,
      details,
      paymentMethod,
      status: isAutoCreditPinDeposit ? 'APPROVED' : 'PENDING',
      processedBy: isAutoCreditPinDeposit ? 'payment_pin_auto' : undefined,
      approverName: isAutoCreditPinDeposit ? 'Payment PIN (Auto)' : undefined,
      adminComment: isAutoCreditPinDeposit ? 'Auto-approved: payment PIN verified' : undefined
    });
    await newRequest.save();

    // Alert Admin
    const alertEmoji = type === 'DEPOSIT' ? '💰' : '💸';
    console.log(`📢 Triggering Telegram alert for ${type} request...`);
    sendAdminAlert(`${alertEmoji} *New ${type} Request!*\n👤 Macmiil: ${user.username}\n💵 Cadadka: *$${amount.toFixed(2)}*\n🏦 Qaabka: ${paymentMethod}`);

    // Verify the request was saved by fetching it back
    const savedRequest = await FinancialRequest.findById(newRequest._id);
    if (!savedRequest) {
      console.error(`❌ CRITICAL: Request ${newRequest._id} was not saved to database!`);
      return res.status(500).json({ error: "Failed to save request to database" });
    }

    if (isAutoCreditPinDeposit) {
      user.balance = roundCurrency(user.balance + amount);
      await autoSettleLoansOnDeposit(user, 'payment PIN auto-credit');
      await user.save();
    }

    // Log the request creation for admin visibility
    console.log(`💰 New ${type} request created and verified:`, {
      requestId: newRequest._id.toString(),
      userId: user._id,
      userName: user.username,
      amount: amount,
      status: savedRequest.status,
      paymentMethod: savedRequest.paymentMethod,
      timestamp: savedRequest.timestamp,
      savedToDB: !!savedRequest
    });

    res.json({
      success: true,
      message: isAutoCreditPinDeposit ? "Deposit credited automatically" : "Request submitted for admin approval",
      request: {
        id: newRequest._id.toString(),
        _id: newRequest._id.toString(),
        shortId: newRequest.shortId,
        userId: newRequest.userId,
        userName: newRequest.userName,
        type: newRequest.type,
        amount: newRequest.amount,
        status: newRequest.status,
        details: newRequest.details || '',
        paymentMethod: newRequest.paymentMethod || '',
        timestamp: newRequest.timestamp ? new Date(newRequest.timestamp).toISOString() : new Date().toISOString()
      }
    });
  } catch (e) {
    console.error("Wallet Request Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// GET: Admin - Get All Requests
app.get('/api/admin/wallet/requests', authenticateToken, async (req, res) => {
  try {
    // Debug: Log token information
    console.log(`🔍 Admin wallet request - Token user info:`, {
      userId: req.user.userId,
      username: req.user.username,
      role: req.user.role
    });

    // Verify admin role - try multiple lookup methods
    // The token contains: { userId, username, role }
    // But userId might not match if user logged in with phone number
    let user = await User.findById(req.user.userId);

    // If not found by ID, try by username
    if (!user && req.user.username) {
      console.log(`⚠️ User not found by ID ${req.user.userId}, trying username: ${req.user.username}`);
      user = await User.findOne({ username: req.user.username });
    }

    // If still not found, try by phone (in case user logged in with phone number)
    if (!user) {
      // Try to find by phone if username looks like a phone number
      const possiblePhone = req.user.username || req.user.userId;
      if (possiblePhone && /^\d+$/.test(possiblePhone)) {
        console.log(`⚠️ User not found by ID/username, trying phone: ${possiblePhone}`);
        user = await User.findOne({
          $or: [
            { phone: possiblePhone },
            { username: possiblePhone }
          ]
        });
      }
    }

    // Last resort: search by any matching field
    if (!user) {
      console.log(`⚠️ Trying comprehensive search for user...`);
      const searchTerm = req.user.userId || req.user.username;
      if (searchTerm) {
        user = await User.findOne({
          $or: [
            { _id: searchTerm },
            { username: searchTerm },
            { phone: searchTerm }
          ]
        });
      }
    }

    if (!user) {
      console.error(`❌ Admin request: User not found in database after all lookup attempts`, {
        tokenUserId: req.user.userId,
        tokenUsername: req.user.username,
        tokenRole: req.user.role
      });

      return res.status(404).json({
        error: "User not found in database. Please log out and log back in.",
        details: `Token userId: ${req.user.userId}, username: ${req.user.username}`,
        suggestion: "If you logged in with phone number, try logging out and logging back in."
      });
    }

    console.log(`✅ User found in database:`, {
      _id: user._id,
      username: user.username,
      role: user.role,
      status: user.status
    });

    // ALLOW ADMIN OR SUPER_ADMIN
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN') {
      console.error(`❌ Admin request DENIED: User ${user.username} (${user._id}) has role "${user.role}", not SUPER_ADMIN/ADMIN`);
      return res.status(403).json({
        error: "Access denied. Admin or Super Admin only.",
        currentRole: user.role,
        userId: user._id,
        username: user.username,
        tokenRole: req.user.role,
        message: `Your account role is "${user.role}". To access admin features, your role must be "ADMIN" or "SUPER_ADMIN".`
      });
    }

    console.log(`📊 Admin ${user.username} (${user._id}) fetching wallet requests...`);

    // Fetch all requests without any filters
    const requests = await FinancialRequest.find().sort({ timestamp: -1 });
    console.log(`📦 Found ${requests.length} total requests in database`);

    if (requests.length > 0) {
      console.log(`📋 Sample request:`, {
        id: requests[0]._id,
        userId: requests[0].userId,
        userName: requests[0].userName,
        type: requests[0].type,
        amount: requests[0].amount,
        status: requests[0].status,
        timestamp: requests[0].timestamp
      });
    }

    // Format requests to include both id and _id for frontend compatibility
    const formattedRequests = requests.map(req => ({
      id: req._id.toString(),
      _id: req._id.toString(),
      shortId: req.shortId,
      userId: req.userId,
      userName: req.userName,
      type: req.type,
      amount: req.amount,
      status: req.status,
      details: req.details || '',
      paymentMethod: req.paymentMethod || '',
      timestamp: req.timestamp ? new Date(req.timestamp).toISOString() : new Date().toISOString(),
      adminComment: req.adminComment || '',
      adminComment: req.adminComment || '',
      processedBy: req.processedBy || '',
      approverName: req.approverName || ''
    }));

    const pendingCount = formattedRequests.filter(r => r.status === 'PENDING').length;
    console.log(`✅ Admin ${user.username} fetched ${formattedRequests.length} wallet requests (${pendingCount} pending)`);

    res.json({ success: true, requests: formattedRequests });
  } catch (e) {
    console.error("❌ Get Wallet Requests Error:", e);
    console.error("Error stack:", e.stack);
    res.status(500).json({ error: e.message });
  }
});

// GET: Diagnostic endpoint to check current user status
app.get('/api/admin/check-status', authenticateToken, async (req, res) => {
  try {
    // Smart user lookup for status check
    const lookupResult = await smartUserLookup(req.user.userId, req.user.username, 'admin-check-status');
    let user = lookupResult.success ? lookupResult.user : null;

    if (!user) {
      return res.json({
        found: false,
        token: {
          userId: req.user.userId,
          username: req.user.username,
          role: req.user.role
        },
        message: "User not found in database"
      });
    }

    return res.json({
      found: true,
      token: {
        userId: req.user.userId,
        username: req.user.username,
        role: req.user.role
      },
      database: {
        _id: user._id,
        username: user.username,
        phone: user.phone,
        role: user.role,
        status: user.status
      },
      match: req.user.userId === user._id.toString(),
      isSuperAdmin: user.role === 'SUPER_ADMIN',
      isAdmin: user.role === 'ADMIN' || user.role === 'SUPER_ADMIN'
    });
  } catch (error) {
    console.error('Check status error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST: Admin - Process Request
app.post('/api/admin/wallet/request/:id', authenticateToken, async (req, res) => {
  try {
    // Smart admin user lookup
    const lookupResult = await smartUserLookup(req.user.userId, req.user.username, 'admin-process-request');
    let adminUser = lookupResult.success ? lookupResult.user : null;

    if (!adminUser || (adminUser.role !== 'SUPER_ADMIN' && adminUser.role !== 'ADMIN')) {
      return res.status(403).json({
        error: "Access denied. Admin or Super Admin only.",
        found: !!adminUser,
        role: adminUser?.role
      });
    }

    const { id } = req.params;
    const { action, adminComment } = req.body; // action: 'APPROVE' | 'REJECT'

    const request = await FinancialRequest.findById(id);
    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    if (request.status !== 'PENDING') {
      return res.status(400).json({ error: "Request is already processed" });
    }

    const user = await User.findById(request.userId);
    if (!user) {
      return res.status(404).json({ error: "User associated with this request not found" });
    }

    if (action === 'APPROVE') {
      if (request.type === 'DEPOSIT') {
        // Double check max balance limit before final approval
        if (user.balance + request.amount > 300) {
          request.status = 'REJECTED';
          request.adminComment = "Rejected: Deposit would exceed maximum wallet balance of $300";
          await request.save();
          return res.json({ success: true, message: "Request rejected (Balance limit exceeded)", request });
        }

        user.balance = roundCurrency(user.balance + request.amount);
        request.status = 'APPROVED';
        request.adminComment = adminComment || "Approved by admin";
        
        // AUTO LOAN SETTLEMENT
        await autoSettleLoansOnDeposit(user, 'approved deposit request');
      } else if (request.type === 'WITHDRAWAL') {
        if (user.balance >= request.amount) {
          user.balance = roundCurrency(user.balance - request.amount);
          request.status = 'APPROVED';
          request.adminComment = adminComment || "Approved by admin";
        } else {
          request.status = 'REJECTED';
          request.adminComment = "Insufficient funds at approval time";
        }
      }
      await user.save();
    } else {
      request.status = 'REJECTED';
      request.adminComment = adminComment || "Rejected by admin";
    }

    // Save the admin ID and Name who processed the request
    request.processedBy = adminUser._id.toString();
    request.approverName = adminUser.username;
    await request.save();

    // Format the request for frontend compatibility
    const formattedRequest = {
      id: request._id.toString(),
      _id: request._id.toString(),
      userId: request.userId,
      userName: request.userName,
      type: request.type,
      amount: request.amount,
      status: request.status,
      details: request.details || '',
      timestamp: request.timestamp ? new Date(request.timestamp).toISOString() : new Date().toISOString(),
      adminComment: request.adminComment || '',
      adminComment: request.adminComment || '',
      processedBy: request.processedBy || '',
      approverName: request.approverName || ''
    };

    // Send real-time notification to user via Socket.IO
    const userRoom = `user_${request.userId}`;
    const notificationData = {
      type: request.type,
      action: request.status,
      amount: request.amount,
      message: request.status === 'APPROVED'
        ? `Your ${request.type.toLowerCase()} of $${request.amount.toFixed(2)} has been approved`
        : `Your ${request.type.toLowerCase()} request has been rejected: ${request.adminComment || 'No reason provided'}`
    };

    io.to(userRoom).emit('financial_request_update', notificationData);

    // Send Web Push notification
    console.log(`🔔 [PUSH DEBUG] Preparing push notification for user ${request.userId} (${user.username})`);
    console.log(`🔔 [PUSH DEBUG] Request type: ${request.type}, Status: ${request.status}, Amount: $${request.amount}`);

    const pushPayload = {
      title: request.status === 'APPROVED'
        ? `✅ ${request.type === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'} Approved`
        : `❌ ${request.type === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'} Rejected`,
      body: request.status === 'APPROVED'
        ? `Your ${request.type.toLowerCase()} of $${request.amount.toFixed(2)} has been approved. ${request.type === 'DEPOSIT' ? 'Funds added to your wallet.' : 'Funds sent to your account.'}`
        : `Your ${request.type.toLowerCase()} of $${request.amount.toFixed(2)} was rejected. ${request.adminComment || 'No reason provided.'}`,
      icon: '/icon-192x192.png',
      badge: '/badge-96x96.png',
      data: {
        type: 'financial_request',
        requestType: request.type,
        status: request.status,
        amount: request.amount,
        url: '/wallet'
      }
    };

    console.log(`🔔 [PUSH DEBUG] Push payload:`, JSON.stringify(pushPayload, null, 2));
    console.log(`🔔 [PUSH DEBUG] Calling sendPushNotificationToUser...`);

    // Send push notification (non-blocking)
    sendPushNotificationToUser(request.userId, pushPayload)
      .then(result => {
        console.log(`🔔 [PUSH DEBUG] Push notification result:`, result);
      })
      .catch(error => {
        console.error('🔔 [PUSH DEBUG] Push notification error:', error);
      });

    res.json({
      success: true,
      message: `Request ${action}D`,
      request: formattedRequest,
      user: {
        // Only include phone if it's a valid number and NOT auto-generated
        // This prevents "auto_..." IDs or usernames from appearing in the Phone field
        phone: (user.phone && !user.phone.startsWith('auto_') && /^\+?[\d\s-]+$/.test(user.phone)) ? user.phone : null
      }
    });
  } catch (e) {
    console.error("Process Request Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// --- MATCH REQUEST SYSTEM (Replaces automatic matchmaking) ---
const activeMatchRequests = new Map(); // requestId -> { userId, userName, stake, timestamp, socketId, expiresAt }
const requestTimers = new Map(); // requestId -> timeoutId
const usersStartingGame = new Set(); // Global lock for users currently entering a game (userId)
const pendingDisconnects = new Map(); // userId -> { timeoutId, gameId } - Graceful disconnect handling

// Clean up expired requests periodically
setInterval(() => {
  const now = Date.now();
  activeMatchRequests.forEach((request, requestId) => {
    if (now >= request.expiresAt) {
      console.log(`⏰ Match request ${requestId} expired`);
      // Notify creator
      const socket = io.sockets.sockets.get(request.socketId);
      if (socket) {
        socket.emit('match_request_expired', { requestId });
      }
      // Broadcast removal to everyone
      io.emit('match_request_removed', { requestId });

      // Cleanup
      activeMatchRequests.delete(requestId);
      const timer = requestTimers.get(requestId);
      if (timer) {
        clearTimeout(timer);
        requestTimers.delete(requestId);
      }
    }
  });
}, 5000); // Check every 5 seconds

// Helper function to create a match between two players
const createMatch = async (player1, player2, stake) => {
  const gameId = Math.random().toString(36).substring(2, 10).toUpperCase();

  // Two-player game: First player = Green, Second player = Blue
  const hostColor = 'green';
  const guestColor = 'blue';

  console.log(`✅ Creating game ${gameId} for players: ${player1.userName || player1.userId} (Green) vs ${player2.userName || player2.userId} (Blue)`);

  // Check for global lock to prevent race conditions (double game creation)
  if (usersStartingGame.has(player1.userId) || usersStartingGame.has(player2.userId)) {
    console.warn(`🔒 Blocked duplicate game creation: One or both users are already starting a game. P1: ${player1.userId}, P2: ${player2.userId}`);
    return;
  }

  // Acquire locks
  usersStartingGame.add(player1.userId);
  usersStartingGame.add(player2.userId);

  // Declare socket variables at function scope so they're accessible in catch block
  let socket1, socket2;

  try {
    // --- Reserve stake from both players ---
    const user1 = await User.findById(player1.userId);
    const user2 = await User.findById(player2.userId);

    if (!user1 || !user2) {
      console.error('❌ CRITICAL: One or both users not found in database for stake reservation.', { p1: player1.userId, p2: player2.userId });
      // Don't create the match
      return;
    }

    // --- AUTO-REJECT PENDING WITHDRAWALS ---
    // User requested to remove withdrawal request immediately if they enter a match
    // to prevent admin from approving it after balance is used for game.
    const withdrawalUpdate1 = await FinancialRequest.updateMany(
      { userId: user1._id, status: 'PENDING', type: 'WITHDRAWAL' },
      {
        status: 'REJECTED',
        adminComment: 'Auto-rejected: User entered a match during pending request',
        processedBy: 'SYSTEM',
        timestamp: new Date()
      }
    );

    const withdrawalUpdate2 = await FinancialRequest.updateMany(
      { userId: user2._id, status: 'PENDING', type: 'WITHDRAWAL' },
      {
        status: 'REJECTED',
        adminComment: 'Auto-rejected: User entered a match during pending request',
        processedBy: 'SYSTEM',
        timestamp: new Date()
      }
    );

    if (withdrawalUpdate1.modifiedCount > 0) {
      console.log(`🚫 Auto-rejected ${withdrawalUpdate1.modifiedCount} pending withdrawals for user ${user1.username} (entered match)`);
    }
    if (withdrawalUpdate2.modifiedCount > 0) {
      console.log(`🚫 Auto-rejected ${withdrawalUpdate2.modifiedCount} pending withdrawals for user ${user2.username} (entered match)`);
    }
    // ---------------------------------------

    // Explicitly check for 0 balance if stake is involved
    if (stake > 0 && (user1.balance <= 0 || user2.balance <= 0)) {
      console.error('❌ Match failed: One or both players have a zero or negative balance for a staked game.');
      const socket1 = io.sockets.sockets.get(player1.socketId);
      const socket2 = io.sockets.sockets.get(player2.socketId);
      if (socket1) socket1.emit('ERROR', { message: 'Match failed: Your opponent has no balance.' });
      if (socket2) socket2.emit('ERROR', { message: 'Match failed: You have no balance to play a staked game.' });
      return;
    }

    // Check if both have enough balance
    if (user1.balance < stake || user2.balance < stake) {
      console.error('❌ CRITICAL: One or both users have insufficient funds at match creation.', {
        p1_bal: user1.balance,
        p2_bal: user2.balance,
        stake: stake
      });
      // Notify players of the error
      const socket1 = io.sockets.sockets.get(player1.socketId);
      const socket2 = io.sockets.sockets.get(player2.socketId);
      if (socket1) socket1.emit('ERROR', { message: 'Match failed: Insufficient funds.' });
      if (socket2) socket2.emit('ERROR', { message: 'Match failed: Insufficient funds.' });
      return;
    }

    // Reserve balance for Player 1
    user1.balance = roundCurrency(user1.balance - stake);
    user1.reservedBalance = roundCurrency((user1.reservedBalance || 0) + stake);
    user1.transactions.push({
      type: 'match_stake',
      amount: -stake,
      matchId: gameId,
      description: `Stake for game ${gameId}`
    });
    await user1.save();

    // Reserve balance for Player 2
    user2.balance = roundCurrency(user2.balance - stake);
    user2.reservedBalance = roundCurrency((user2.reservedBalance || 0) + stake);
    user2.transactions.push({
      type: 'match_stake',
      amount: -stake,
      matchId: gameId,
      description: `Stake for game ${gameId}`
    });
    await user2.save();

    console.log(`💰 Reserved ${stake} from both players. ${user1.username}: bal=${user1.balance}, reserved=${user1.reservedBalance}. ${user2.username}: bal=${user2.balance}, reserved=${user2.reservedBalance}`);
    // --- End of reservation logic ---

    // First player (host) joins as Green
    const hostResult = await gameEngine.handleJoinGame(
      gameId,
      player1.userId || player1.socketId,
      hostColor,
      player1.socketId
    );

    // Second player (guest) joins as Blue
    const guestResult = await gameEngine.handleJoinGame(
      gameId,
      player2.userId || player2.socketId,
      guestColor,
      player2.socketId
    );

    // Get sockets - trust the socket IDs from the request (already validated)
    socket1 = io.sockets.sockets.get(player1.socketId);
    socket2 = io.sockets.sockets.get(player2.socketId);

    console.log(`🔍 Socket check - Player1: ${player1.socketId} (${socket1 ? 'found' : 'NOT FOUND'}), Player2: ${player2.socketId} (${socket2 ? 'found' : 'NOT FOUND'})`);

    // If either socket is missing, refund and abort
    if (!socket1 || !socket2) {
      console.error('❌ CRITICAL: Socket(s) not found. Match creation failed.');

      // Try to refund the stakes since match failed
      try {
        // ✅ FIX: Use atomic updates instead of save() to guarantee consistency
        await User.updateOne(
          { _id: user1._id },
          {
            $inc: {
              balance: stake,
              reservedBalance: -stake
            },
            $push: {
              transactions: {
                type: 'game_refund',
                amount: stake,
                matchId: gameId,
                description: `Match creation failed - full refund for game ${gameId}`,
                timestamp: new Date()
              }
            }
          }
        );

        await User.updateOne(
          { _id: user2._id },
          {
            $inc: {
              balance: stake,
              reservedBalance: -stake
            },
            $push: {
              transactions: {
                type: 'game_refund',
                amount: stake,
                matchId: gameId,
                description: `Match creation failed - full refund for game ${gameId}`,
                timestamp: new Date()
              }
            }
          }
        );

        console.log(`💰 Full atomic refunds completed for both players due to match creation failure`);
      } catch (refundError) {
        console.error('❌ CRITICAL: Atomic refund failed:', refundError);
        // TODO: Log to database for manual resolution
      }

      return;
    }

    // Join game rooms if sockets are available
    if (socket1) {
      socket1.join(gameId);
      socket1.gameId = gameId;
    }
    if (socket2) {
      socket2.join(gameId);
      socket2.gameId = gameId;
    }

    // Update game state to started with random turn order
    if (guestResult.success && guestResult.state) {
      const Game = require('./models/Game');
      const game = await Game.findOne({ gameId });
      if (game) {
        // Randomly decide which player goes first (0 = Green, 1 = Blue)
        const randomStartingPlayer = Math.floor(Math.random() * 2);
        const startingColor = randomStartingPlayer === 0 ? 'Green' : 'Blue';

        game.status = 'ACTIVE';
        game.gameStarted = true;
        game.message = `Game started! ${startingColor} goes first.`;
        game.turnState = 'ROLLING';
        game.currentPlayerIndex = randomStartingPlayer;
        game.diceValue = null; // Ensure diceValue is null at game start
        game.legalMoves = []; // Ensure legalMoves is empty at game start
        game.stake = stake;
        await game.save();
        console.log(`✅ Game ${gameId} marked as started - ${startingColor} (index ${randomStartingPlayer}) goes first`);
      }
    }

    // Notify both players
    const player1MatchData = {
      gameId,
      playerColor: hostColor,
      opponent: { userId: player2.userId, userName: player2.userName },
      stake
    };

    const player2MatchData = {
      gameId,
      playerColor: guestColor,
      opponent: { userId: player1.userId, userName: player1.userName },
      stake
    };

    console.log(`📡 Sending match_found to both players`);

    // Emit directly to sockets
    socket1.emit('match_found', player1MatchData);
    socket2.emit('match_found', player2MatchData);

    // Also emit to userId rooms for extra reliability
    if (player1.userId) {
      io.to(`user_${player1.userId}`).emit('match_found', player1MatchData);
    }
    if (player2.userId) {
      io.to(`user_${player2.userId}`).emit('match_found', player2MatchData);
    }

    console.log(`✅ Match notifications sent to both players`);

    // Alert Admin
    sendAdminAlert(`🎲 *Match Started!*\n👥 ${player1.userName || 'Player 1'} vs ${player2.userName || 'Player 2'}\n💰 Stake: *$${stake.toFixed(2)}*`);

    // Send initial game state to both players immediately (no delay)
    if (guestResult.success && guestResult.state) {
      const Game = require('./models/Game');
      const game = await Game.findOne({ gameId });
      if (game) {
        // Ensure all players are properly marked as not AI and not disconnected
        // For multiplayer games, ALL players should be human (isAI: false)
        let playerFlagsUpdated = false;
        game.players.forEach(player => {
          // Always set isAI to false for multiplayer games - no bots allowed
          if (player.isAI !== false) {
            player.isAI = false;
            playerFlagsUpdated = true;
            console.log(`🔧 Forced ${player.color} to be human (isAI: false) in multiplayer game ${gameId}`);
          }
          if (player.isDisconnected === undefined || player.isDisconnected === null || player.isDisconnected === true) {
            // Only set isDisconnected to false if they have a socket
            if (player.socketId) {
              player.isDisconnected = false;
              playerFlagsUpdated = true;
            }
          }
        });

        if (playerFlagsUpdated) {
          await game.save();
          console.log(`✅ Updated player flags in initial game state for game ${gameId}`);
        }

        const gameState = game.toObject ? game.toObject() : game;
        const finalState = {
          ...gameState,
          gameStarted: true,
          status: 'ACTIVE',
          turnState: 'ROLLING',
          diceValue: null, // Ensure diceValue is null at game start
          legalMoves: [] // Ensure legalMoves is empty at game start
        };
        console.log(`📤 Sending initial GAME_STATE_UPDATE to game ${gameId} with ${finalState.players?.length} players`);
        console.log(`📤 Player details:`, finalState.players?.map(p => ({
          color: p.color,
          isAI: p.isAI,
          isDisconnected: p.isDisconnected,
          hasSocket: !!p.socketId
        })));
        console.log(`📤 Initial game state: currentPlayerIndex=${finalState.currentPlayerIndex}, turnState=${finalState.turnState}, diceValue=${finalState.diceValue}, gameStarted=${finalState.gameStarted}`);

        // Ensure state is a plain object
        io.to(gameId).emit('GAME_STATE_UPDATE', { state: prepareGameStateForEmit(finalState) });

        // Start timer for first player if human and connected
        const firstPlayer = game.players[game.currentPlayerIndex];
        console.log(`📤 First player: ${firstPlayer?.color}, isAI: ${firstPlayer?.isAI}, isDisconnected: ${firstPlayer?.isDisconnected}, socketId: ${firstPlayer?.socketId}`);

        // CRITICAL: Ensure first player is NOT marked as AI or disconnected if they have a socket
        if (firstPlayer && firstPlayer.socketId) {
          // Force human players to be marked correctly
          if (firstPlayer.isAI !== false) {
            firstPlayer.isAI = false;
            console.log(`🔧 Fixed: Set ${firstPlayer.color} isAI to false (had socketId)`);
          }
          if (firstPlayer.isDisconnected !== false) {
            firstPlayer.isDisconnected = false;
            console.log(`🔧 Fixed: Set ${firstPlayer.color} isDisconnected to false (had socketId)`);
          }
          await game.save();
        }

        // Check if first player is Human/Connected and START TIMER
        if (firstPlayer && firstPlayer.socketId) {
          console.log(`⏱️ Starting auto-roll timer for first player ${firstPlayer.color} in game ${gameId}`);
          scheduleHumanPlayerAutoRoll(gameId);
        } else if (firstPlayer && !firstPlayer.socketId && (firstPlayer.isAI || firstPlayer.isDisconnected)) {
          // Only auto-roll if player has NO socketId AND is marked as AI/disconnected
          console.log(`🤖 First player ${firstPlayer.color} has no socketId and is AI/disconnected, scheduling auto-turn`);
          scheduleAutoTurn(gameId, AUTO_TURN_DELAYS.AI_ROLL);
        } else if (firstPlayer) {
          // Fallback for unclear state - schedule timer to be safe
          console.log(`⚠️ First player ${firstPlayer.color} state unclear - scheduling auto-roll timer for safety`);
          scheduleHumanPlayerAutoRoll(gameId);
        } else {
          console.log(`⚠️ First player not found`);
        }
      }
    }

    return gameId; // Return the created gameId
  } catch (error) {
    if (socket1) socket1.emit('ERROR', { message: 'Failed to create game' });
    if (socket2) socket2.emit('ERROR', { message: 'Failed to create game' });
    throw error;
  } finally {
    // Release locks
    usersStartingGame.delete(player1.userId);
    usersStartingGame.delete(player2.userId);
    console.log(`🔓 Released start-game locks for ${player1.userName || player1.userId} and ${player2.userName || player2.userId}`);
  }
};

const removeFromQueue = (socketId) => {
  // Find and remove any active match requests for this socket
  for (const [requestId, request] of activeMatchRequests.entries()) {
    if (request.socketId === socketId) {
      console.log(`❌ Removing match request ${requestId} due to creator disconnect`);

      // Clear timer
      const timer = requestTimers.get(requestId);
      if (timer) {
        clearTimeout(timer);
        requestTimers.delete(requestId);
      }

      // Remove request
      activeMatchRequests.delete(requestId);

      // Notify others
      io.emit('match_request_removed', { requestId });
    }
  }
};

// Clean up expired requests periodically



const humanPlayerTimers = new Map(); // gameId -> timer reference
const timerBroadcasts = new Map(); // gameId -> { intervalId, timeLeft } for countdown broadcast


// ===== AUTO-TURN TIMING CONSTANTS (FASTER) =====
const AUTO_TURN_DELAYS = {
  AI_ROLL: 3000,           // Increased to 3s for pacing
  AI_MOVE: 4000,           // Increased to 4s to let user see dice roll
  AI_QUICK_MOVE: 150,      // Keep quick for quick successive moves if any
  ANIMATION_WAIT: 800,     // Increased slightly
  STUCK_RECOVERY: 2000,    // Increased
  NO_MOVES_DELAY: 3000     // Increased
};

// ===== TIMER BROADCAST SYSTEM =====
const startTimerBroadcast = (gameId, initialTime, timerType = 'roll') => {
  stopTimerBroadcast(gameId);
  let timeLeft = initialTime;
  const intervalId = setInterval(async () => {
    timeLeft--;
    if (timeLeft <= 0) {
      stopTimerBroadcast(gameId);
      return;
    }
    io.to(gameId).emit('TIMER_TICK', { timer: timeLeft });
  }, 1000);
  timerBroadcasts.set(gameId, { intervalId, timeLeft: initialTime });
};

const stopTimerBroadcast = (gameId) => {
  if (timerBroadcasts.has(gameId)) {
    const { intervalId } = timerBroadcasts.get(gameId);
    clearInterval(intervalId);
    timerBroadcasts.delete(gameId);
  }
};

const clearAllTimersForGame = (gameId) => {
  if (humanPlayerTimers.has(gameId)) {
    clearTimeout(humanPlayerTimers.get(gameId));
    humanPlayerTimers.delete(gameId);
  }
  stopTimerBroadcast(gameId);
};

const scheduleHumanPlayerAutoRoll = (gameId) => {
  if (humanPlayerTimers.has(gameId)) {
    clearTimeout(humanPlayerTimers.get(gameId));
  }
  // Timer: 7s (Fast pace as requested)
  startTimerBroadcast(gameId, 7, 'roll');
  const timer = setTimeout(async () => {
    humanPlayerTimers.delete(gameId);
    const Game = require('./models/Game');
    const game = await Game.findOne({ gameId });
    if (!game || game.status !== 'ACTIVE' || game.turnState !== 'ROLLING') return;

    try {
      const result = await gameEngine.handleAutoRoll(gameId, true);
      if (result && result.success) {
        const gameState = result.state;
        io.to(gameId).emit('GAME_STATE_UPDATE', { state: prepareGameStateForEmit(gameState) });
        if (gameState.legalMoves.length === 0) {
          setTimeout(async () => {
            const passTurnResult = await gameEngine.handlePassTurn(gameId); // Assume exists or handle via engine
            // Fallback if handlePassTurn not handy: manually update
            // Actually, gameEngine.handleAutoMove usually handles 'no moves' logic via calling getNextPlayer
            // But let's trust the engine for now.
            io.to(gameId).emit('GAME_STATE_UPDATE', { state: prepareGameStateForEmit(passTurnResult?.state || gameState) });
            if (passTurnResult?.state) {
              const nextPlayer = passTurnResult.state.players[passTurnResult.state.currentPlayerIndex];
              if (nextPlayer && !nextPlayer.isAI && !nextPlayer.isDisconnected) {
                scheduleHumanPlayerAutoRoll(gameId);
              }
            }
          }, 4000); // Increased auto-pass delay to 4000ms
        } else {
          // Whether it's 1 move, 2 moves, or 10 moves, ALWAYS wait for the human to choose.
          // Consent is key. Do not auto-move.
          scheduleHumanPlayerAutoMove(gameId);
        }
      } else {
        console.log(`⚠️ Auto-roll failed for ${gameId}: ${result?.message}`);
      }
    } catch (error) {
      console.error(`❌ Error in auto-roll timer for ${gameId}:`, error);
    }
  }, 7000); // 7s buffer
  humanPlayerTimers.set(gameId, timer);
};

const scheduleHumanPlayerAutoMove = (gameId) => {
  if (humanPlayerTimers.has(gameId)) {
    clearTimeout(humanPlayerTimers.get(gameId));
  }
  // Timer: 14s (Fast pace as requested)
  startTimerBroadcast(gameId, 14, 'move');
  const timer = setTimeout(async () => {
    humanPlayerTimers.delete(gameId);
    const Game = require('./models/Game');
    const game = await Game.findOne({ gameId });
    if (!game || game.status !== 'ACTIVE' || game.turnState !== 'MOVING') return;
    try {
      const result = await gameEngine.handleAutoMove(gameId);
      if (result && result.success) {
        const plainState = result.state;
        io.to(gameId).emit('GAME_STATE_UPDATE', { state: prepareGameStateForEmit(plainState) });
        const nextPlayer = plainState.players[plainState.currentPlayerIndex];
        if (plainState.turnState === 'ROLLING') {
          if (nextPlayer && !nextPlayer.isAI && !nextPlayer.isDisconnected) {
            scheduleHumanPlayerAutoRoll(gameId);
          } else if (nextPlayer) {
            scheduleAutoTurn(gameId, AUTO_TURN_DELAYS.AI_MOVE);
          }
        }
      } else {
        console.log(`⚠️ Auto-move failed for ${gameId}: ${result?.message}`);
      }
    } catch (error) {
      console.error(`❌ Error in auto-move timer for ${gameId}:`, error);
    }
  }, 14000); // 14s buffer
  humanPlayerTimers.set(gameId, timer);
};

const scheduleAutoTurn = async (gameId, delay = AUTO_TURN_DELAYS.AI_ROLL) => {
  const Game = require('./models/Game');
  try {
    const game = await Game.findOne({ gameId });
    if (game && game.gameStarted && game.status === 'ACTIVE') {
      const currentPlayer = game.players[game.currentPlayerIndex];
      if (currentPlayer && currentPlayer.socketId && !currentPlayer.isAI && !currentPlayer.isDisconnected) return;
    }
  } catch (err) { }
  if (activeAutoTurns.has(gameId)) return;
  activeAutoTurns.add(gameId);
  setTimeout(async () => {
    activeAutoTurns.delete(gameId);
    await runAutoTurn(gameId);
  }, delay);
};

const runAutoTurn = async (gameId) => {
  const Game = require('./models/Game');
  const gameRecord = await Game.findOne({ gameId });
  if (!gameRecord || !gameRecord.gameStarted || gameRecord.status !== 'ACTIVE') return;

  const currentPlayerFromDb = gameRecord.players[gameRecord.currentPlayerIndex];
  if (!currentPlayerFromDb) return;
  if (currentPlayerFromDb.socketId && !currentPlayerFromDb.isAI && !currentPlayerFromDb.isDisconnected) return;

  let result = await gameEngine.handleAutoRoll(gameId);
  if (!result.success) result = await gameEngine.handleAutoMove(gameId);

  if (result.success) {
    const plainState = result.state.toObject ? result.state.toObject() : result.state;
    if (plainState.diceValue !== null && plainState.diceValue !== undefined) plainState.diceValue = Number(plainState.diceValue);
    io.to(gameId).emit('GAME_STATE_UPDATE', { state: prepareGameStateForEmit(plainState) });

    if (plainState.legalMoves && plainState.legalMoves.length === 0 && plainState.diceValue !== null && plainState.turnState === 'MOVING') {
      setTimeout(async () => {
        // Pass turn logic
        const game = await Game.findOne({ gameId });
        if (game && game.turnState === 'MOVING' && game.legalMoves.length === 0) {
          const nextPlayerIndex = gameEngine.getNextPlayerIndex(game, game.currentPlayerIndex, game.diceValue === 6);
          game.currentPlayerIndex = nextPlayerIndex;
          game.diceValue = null;
          game.turnState = 'ROLLING';
          game.legalMoves = [];
          await game.save();
          const updatedState = game.toObject ? game.toObject() : game;
          io.to(gameId).emit('GAME_STATE_UPDATE', { state: prepareGameStateForEmit(updatedState) });
          const nextPlayer = game.players[nextPlayerIndex];
          if (nextPlayer && (nextPlayer.isAI || nextPlayer.isDisconnected)) scheduleAutoTurn(gameId, AUTO_TURN_DELAYS.AI_ROLL);
        }
      }, 1200);
      return;
    }

    const game = result.state;
    if (game.turnState === 'MOVING') {
      scheduleAutoTurn(gameId, AUTO_TURN_DELAYS.AI_MOVE);
    } else if (game.turnState === 'ROLLING') {
      const updatedGameRecord = await Game.findOne({ gameId });
      if (updatedGameRecord) {
        const nextPlayerIndex = updatedGameRecord.currentPlayerIndex;
        const nextPlayerFromDb = updatedGameRecord.players[nextPlayerIndex];
        if (nextPlayerFromDb && (nextPlayerFromDb.isAI || nextPlayerFromDb.isDisconnected)) {
          scheduleAutoTurn(gameId, AUTO_TURN_DELAYS.AI_ROLL);
        } else if (nextPlayerFromDb && !nextPlayerFromDb.isAI && !nextPlayerFromDb.isDisconnected) {
          scheduleHumanPlayerAutoRoll(gameId);
        }
      }
    }
  }
};

io.on('connection', (socket) => {
  socket.on('register_user', ({ userId }) => {
    if (userId) {
      socket.data.userId = userId;
      const userRoom = `user_${userId}`;
      socket.join(userRoom);
      socket.emit('registration_confirmed', { userId, room: userRoom, socketId: socket.id });
    }
  });



  socket.on('create_match_request', async ({ stake, userName, userId }) => {
    try {
      // ✅ FIX: Accept userId from payload, fallback to socket.data
      const effectiveUserId = userId || socket.data.userId;
      if (!effectiveUserId) {
        console.error('❌ create_match_request: No userId provided or stored');
        return socket.emit('ERROR', { message: 'Authentication required' });
      }

      const numericStake = parseFloat(stake);
      if (!numericStake || numericStake <= 0 || isNaN(numericStake)) {
        return socket.emit('ERROR', { message: 'Invalid stake amount' });
      }
      const user = await User.findById(effectiveUserId);
      if (!user) {
        return socket.emit('ERROR', { message: 'User not found' });
      }
      if (user.role === 'SUPER_ADMIN') {
        return socket.emit('ERROR', { message: 'Super Admin cannot create match requests' });
      }
      for (const [id, req] of activeMatchRequests.entries()) {
        if (req.userId === effectiveUserId) {
          return socket.emit('ERROR', { message: 'You already have an active match request' });
        }
      }
      const activeGame = await Game.findOne({ status: 'ACTIVE', 'players.userId': effectiveUserId });
      if (activeGame) {
        return socket.emit('ERROR', { message: 'You are already in an active game. Please finish it first.' });
      }
      // FIX: Use rounding to prevent floating point errors (e.g. 0.24999 < 0.25)
      if (Math.round(user.balance * 100) < Math.round(numericStake * 100)) {
        return socket.emit('ERROR', { message: 'Insufficient funds to create match request' });
      }

      const requestId = crypto.randomBytes(8).toString('hex');
      const expiresAt = Date.now() + 120000;

      const request = { requestId, userId: effectiveUserId, userName: userName || user.username, stake: numericStake, socketId: socket.id, expiresAt, createdAt: Date.now() };
      activeMatchRequests.set(requestId, request);

      const timer = setTimeout(() => {
        activeMatchRequests.delete(requestId);
        requestTimers.delete(requestId);
        const creatorSocket = io.sockets.sockets.get(request.socketId);
        if (creatorSocket) {
          creatorSocket.emit('match_request_expired', { requestId });
        }
        io.emit('match_request_removed', { requestId });
      }, 120000);
      requestTimers.set(requestId, timer);

      socket.emit('match_request_created', { requestId });
      const broadcastRequest = { requestId, userId: effectiveUserId, userName: userName || user.username, stake: numericStake, timeRemaining: 120 };
      socket.broadcast.emit('new_match_request', { request: broadcastRequest });
    } catch (error) {
      socket.emit('ERROR', { message: 'Failed to create match request: ' + error.message });
    }
  });

  socket.on('accept_match_request', async ({ requestId, userName, userId }) => {
    // CRITICAL: Fetch request FIRST before any validation
    // ✅ FIX: Accept userId from payload, fallback to socket.data
    const effectiveUserId = userId || socket.data.userId;
    if (!effectiveUserId) {
      console.error('❌ accept_match_request: No userId provided or stored');
      return socket.emit('ERROR', { message: 'Authentication required' });
    }

    const request = activeMatchRequests.get(requestId);
    if (!request) {
      return socket.emit('ERROR', { message: 'Match request no longer available' });
    }
    if (request.userId === effectiveUserId) {
      return socket.emit('ERROR', { message: 'Cannot accept your own match request' });
    }

    try {
      // Validate MongoDB ObjectId format before querying
      if (!effectiveUserId || typeof effectiveUserId !== 'string') {
        console.error(`[MATCHMAKING] Invalid userId format: ${effectiveUserId}`);
        return socket.emit('ERROR', { message: 'Invalid user ID' });
      }

      // CRITICAL FIX: Fetch the acceptor user from database with error handling
      let acceptor;
      try {
        acceptor = await User.findById(effectiveUserId);
      } catch (dbError) {
        console.error(`[MATCHMAKING] Database error finding user ${effectiveUserId}:`, dbError);
        return socket.emit('ERROR', { message: 'Failed to verify user' });
      }

      if (!acceptor) {
        console.error(`[MATCHMAKING] User not found: ${effectiveUserId}`);
        return socket.emit('ERROR', { message: 'User not found' });
      }

      // FIX: Use rounding to prevent floating point errors
      if (Math.round(acceptor.balance * 100) < Math.round(request.stake * 100)) {
        console.log(`[MATCHMAKING] User ${effectiveUserId} has insufficient balance: ${acceptor.balance} < ${request.stake}`);
        return socket.emit('ERROR', { message: 'Insufficient funds' });
      }

      // DUPLICATE MATCH PREVENTION
      // 1. Check if acceptor is already in an active game
      const acceptorActiveGame = await Game.findOne({ status: 'ACTIVE', 'players.userId': effectiveUserId });
      if (acceptorActiveGame) {
        return socket.emit('ERROR', { message: 'You are already in an active game.' });
      }

      // 2. Check if acceptor has an active match request (cleanup)
      for (const [id, req] of activeMatchRequests.entries()) {
        if (req.userId === effectiveUserId) {
          // Remove their request automatically or block?
          // Let's block to avoid confusion, or auto-remove. Blocking is safer.
          return socket.emit('ERROR', { message: 'You have an active match request. Cancel it first.' });
        }
      }

      // 3. RACE CONDITION CHECK: Check if creator is already in an active game
      // (They might have accepted another request or started a game in parallel)
      const creatorActiveGame = await Game.findOne({ status: 'ACTIVE', 'players.userId': request.userId });
      if (creatorActiveGame) {
        activeMatchRequests.delete(requestId); // Invalid request now
        io.emit('match_request_removed', { requestId });
        return socket.emit('ERROR', { message: 'The match creator is already in a game.' });
      }

      activeMatchRequests.delete(requestId);
      const timer = requestTimers.get(requestId);
      if (timer) {
        clearTimeout(timer);
        requestTimers.delete(requestId);
      }
      io.emit('match_request_accepted', { requestId, acceptorName: userName || acceptor.username });
      await createMatch({ socketId: request.socketId, userId: request.userId, userName: request.userName }, { socketId: socket.id, userId: effectiveUserId, userName: userName || acceptor.username }, request.stake);
    } catch (error) {
      console.error(`[MATCHMAKING CRITICAL] Unexpected error in accept_match_request:`, error);
      return socket.emit('ERROR', { message: 'Failed to process match request' });
    }
  });

  socket.on('cancel_match_request', async ({ requestId, userId }) => {
    // ✅ FIX: Accept userId from payload, fallback to socket.data
    const effectiveUserId = userId || socket.data.userId;
    const request = activeMatchRequests.get(requestId);
    if (request && String(request.userId) === String(effectiveUserId)) {
      activeMatchRequests.delete(requestId);
      const timer = requestTimers.get(requestId);
      if (timer) {
        clearTimeout(timer);
        requestTimers.delete(requestId);
      }
      io.emit('match_request_removed', { requestId });
      socket.emit('match_request_cancel_success');
    }
  });

  socket.on('request_refund', async ({ gameId, reason }) => {
    console.log(`🔄 REFUND REQUEST attempt from ${socket.id} for game ${gameId}`);
    try {
      // 🔒 SECURITY CHECK: Only Admins can manually request refunds via this socket event
      // Map userId from socket data if available, or verify via other means
      const userId = socket.data.userId;
      if (!userId) return socket.emit('ERROR', { message: 'Authentication required' });

      const user = await User.findById(userId);
      if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN')) {
        console.warn(`🚨 Unauthorized refund attempt by user ${user?.username || userId}`);
        return socket.emit('ERROR', { message: 'Access denied. Unauthorized activity logged.' });
      }

      const result = await gameEngine.processGameRefund(gameId);
      if (result.success) {
        // Clear all timers
        if (typeof clearAllTimersForGame === 'function') clearAllTimersForGame(gameId);

        // Remove from active auto turns
        if (activeAutoTurns.has(gameId)) activeAutoTurns.delete(gameId);

        // Notify all players in the room
        io.to(gameId).emit('GAME_CANCELLED', { message: 'Game has been cancelled and refunded.' });

        // Forcefully stop any further updates? Status check in engine handles that.
        console.log(`✅ Game ${gameId} cancelled and refunded successfully.`);
      } else {
        socket.emit('ERROR', { message: result.message || 'Refund failed' });
      }
    } catch (error) {
      console.error('Refund request error:', error);
      socket.emit('ERROR', { message: 'Refund processing error' });
    }
  });

  socket.on('get_active_requests', async ({ userId }) => {
    const user = await User.findById(userId);
    const userBalance = user ? user.balance : 0;
    const requests = Array.from(activeMatchRequests.values())
      .filter(req => req.userId !== userId)
      .map(req => ({ ...req, canAccept: userBalance >= req.stake, timeRemaining: Math.max(0, Math.floor((req.expiresAt - Date.now()) / 1000)) }));
    socket.emit('active_requests', { requests });
  });

  socket.on('watch_game', async ({ gameId }) => {
    socket.join(gameId);
    socket.gameId = gameId; // Set gameId for better session tracking

    try {
      const game = await Game.findOne({ gameId });
      if (game) {
        socket.emit('GAME_STATE_UPDATE', { state: prepareGameStateForEmit(game) });
      } else {
        socket.emit('ERROR', { message: 'Game not found' });
      }
    } catch (error) { console.error(error); }
  });

  socket.on('join_game', async ({ gameId, userId, playerColor }) => {
    socket.join(gameId);
    socket.gameId = gameId;

    // FIX: Ensure userId is a string for map lookup (DB uses ObjectId)
    const userIdString = String(userId);

    if (pendingDisconnects.has(userIdString)) {
      const pending = pendingDisconnects.get(userIdString);
      if (pending && pending.gameId === gameId) {
        console.log(`🔌 Cleared pending disconnect for user ${userIdString} rejoining game ${gameId}`);
        clearTimeout(pending.timeoutId);
        pendingDisconnects.delete(userIdString);
      }
    }
    const result = await gameEngine.handleJoinGame(gameId, userId, playerColor, socket.id);
    if (result.success && result.state) {
      const plainState = result.state.toObject ? result.state.toObject() : result.state;
      io.to(gameId).emit('GAME_STATE_UPDATE', { state: prepareGameStateForEmit(plainState) });

      if (result.state.status === 'ACTIVE') {
        const currentPlayer = result.state.players[result.state.currentPlayerIndex];

        // RESUME LOGIC: Check whose turn it is
        if (currentPlayer && String(currentPlayer.userId) === String(userId) && !currentPlayer.isAI) {
          // It's MY turn - Restart my timer
          console.log(`▶️ Resuming game ${gameId} - Player ${currentPlayer.color} (Rejoined) turn`);
          if (result.state.turnState === 'ROLLING') scheduleHumanPlayerAutoRoll(gameId);
          else if (result.state.turnState === 'MOVING') scheduleHumanPlayerAutoMove(gameId);
        } else if (currentPlayer && (currentPlayer.isAI || currentPlayer.isDisconnected)) {
          // It's OPPONENT'S turn and they are away - Kickstart Bot
          console.log(`▶️ Resuming game ${gameId} - Opponent ${currentPlayer.color} (AI/Disc) turn`);
          // Add a small delay so the frontend has time to load
          const delay = result.state.turnState === 'ROLLING' ? AUTO_TURN_DELAYS.AI_ROLL : AUTO_TURN_DELAYS.AI_MOVE;
          scheduleAutoTurn(gameId, delay + 500);
        }
      }
    } else {
      socket.emit('ERROR', { message: result.message || 'Failed to join game.' });
    }
  });

  socket.on('roll_dice', async ({ gameId, userId }) => {
    console.log(`[SOCKET] Received roll_dice for game: ${gameId}, from socket: ${socket.id}`);
    if (humanPlayerTimers.has(gameId)) {
      clearTimeout(humanPlayerTimers.get(gameId));
      humanPlayerTimers.delete(gameId);
    }

    const rollUserId = userId || socket.data.userId;
    console.log(`[SOCKET] Calling gameEngine.handleRollDice for game: ${gameId}, socket: ${socket.id}, userId: ${rollUserId}`);
    const result = await gameEngine.handleRollDice(gameId, socket.id, rollUserId);
    console.log(`[SOCKET] gameEngine.handleRollDice result for ${gameId}: success=${result?.success}, message=${result?.message}`);
    if (!result) {
      console.error(`[SOCKET] gameEngine.handleRollDice returned null for game ${gameId}`);
      return socket.emit('ERROR', { message: 'Failed to roll dice' });
    }

    if (result.success) {
      const gameState = prepareGameStateForEmit(result.state);
      io.to(gameId).emit('GAME_STATE_UPDATE', { state: gameState });

      if (gameState.legalMoves && gameState.legalMoves.length > 0) {
        const currentPlayer = gameState.players[gameState.currentPlayerIndex];
        if (currentPlayer && !currentPlayer.isAI && !currentPlayer.isDisconnected) {
          scheduleHumanPlayerAutoMove(gameId);
        }
      } else if (gameState.legalMoves && gameState.legalMoves.length === 0 && gameState.diceValue !== null) {
        console.log(`🎲 No legal moves for game ${gameId}. Scheduling auto-pass in 4.0s...`);
        if (humanPlayerTimers.has(gameId)) { clearTimeout(humanPlayerTimers.get(gameId)); humanPlayerTimers.delete(gameId); }
        setTimeout(async () => {
          console.log(`🎲 Executing auto-pass for game ${gameId}...`);
          const game = await Game.findOne({ gameId });
          if (game && game.turnState === 'MOVING' && game.legalMoves.length === 0) {
            console.log(`🎲 Auto-pass condition met for game ${gameId}. Passing turn.`);
            const nextPlayerIndex = gameEngine.getNextPlayerIndex(game, game.currentPlayerIndex, game.diceValue === 6);
            game.currentPlayerIndex = nextPlayerIndex;
            game.diceValue = null;
            game.turnState = 'ROLLING';
            game.legalMoves = [];
            // FIX: Ensure lastEvent is cleared
            // game.lastEvent = null; 
            await game.save();
            io.to(gameId).emit('GAME_STATE_UPDATE', { state: prepareGameStateForEmit(game) });
            const nextPlayer = game.players[nextPlayerIndex];
            if (nextPlayer && (nextPlayer.isAI || nextPlayer.isDisconnected)) scheduleAutoTurn(gameId, AUTO_TURN_DELAYS.AI_ROLL);
            else if (nextPlayer) scheduleHumanPlayerAutoRoll(gameId);
          } else {
            console.log(`⚠️ Auto-pass aborted for game ${gameId}. State mismatch: Turn=${game?.turnState}, Moves=${game?.legalMoves?.length}`);
          }
        }, 4000); // 4.0s delay for auto-pass (gave player time to reroll)
      }

      const gameRecord = await Game.findOne({ gameId });
      if (gameRecord && result.state.turnState === 'ROLLING') {
        const nextPlayer = gameRecord.players[gameRecord.currentPlayerIndex];
        if (nextPlayer && (nextPlayer.isAI || nextPlayer.isDisconnected)) {
          console.log(`[SOCKET] Scheduling auto-turn for AI/disconnected player ${nextPlayer.color} in game ${gameId}`);
          scheduleAutoTurn(gameId);
        } else if (nextPlayer) {
          console.log(`[SOCKET] Scheduling human player auto-roll timer for ${nextPlayer.color} in game ${gameId}`);
          scheduleHumanPlayerAutoRoll(gameId);
        }
      }

    } else {
      console.error(`[SOCKET] Error in roll_dice for game ${gameId}: ${result.message || 'Failed to roll dice'}`);
      
      const isHarmless = result.message === 'Wait for animation' || 
                         result.message === 'Not rolling state' || 
                         result.message === 'Not in ROLLING state';

      if (!isHarmless) {
        socket.emit('ERROR', { message: result.message || 'Failed to roll dice' });
      }

      // CRITICAL FIX: Restart timer if roll failed but game is still active
      // This prevents the game from getting stuck if a user request fails validation

      const gameCheck = await Game.findOne({ gameId });
      if (gameCheck && gameCheck.status === 'ACTIVE' && gameCheck.turnState === 'ROLLING') {
        const currentPlayer = gameCheck.players[gameCheck.currentPlayerIndex];
        if (currentPlayer && currentPlayer.socketId === socket.id) {
          console.log(`[SOCKET] Restarting timer for ${currentPlayer.color} after failed roll`);
          scheduleHumanPlayerAutoRoll(gameId);
        }
      }

      if (isHarmless) {
        // If we have gameCheck already, use it
        if (gameCheck) {
          console.log(`[SOCKET] Emitting GAME_STATE_UPDATE due to specific error for game ${gameId}`);
          socket.emit('GAME_STATE_UPDATE', { state: prepareGameStateForEmit(gameCheck) });
        }
      }
    }
  });

  socket.on('move_token', async ({ gameId, tokenId }) => {
    if (humanPlayerTimers.has(gameId)) { clearTimeout(humanPlayerTimers.get(gameId)); humanPlayerTimers.delete(gameId); }


    const result = await gameEngine.handleMoveToken(gameId, socket.id, tokenId);

    if (result.success) {
      const plainState = result.state.toObject ? result.state.toObject() : result.state;
      if (result.killedTokenId) io.to(gameId).emit('TOKEN_KILLED', { killedTokenId: result.killedTokenId });

      if (plainState.turnState !== 'ROLLING' && plainState.diceValue === null) plainState.turnState = 'ROLLING';
      io.to(gameId).emit('GAME_STATE_UPDATE', { state: prepareGameStateForEmit(plainState) });
      if (result.settlementData) {
        const winnerPlayer = plainState.players.find(p => p.userId === result.settlementData.winnerId);
        if (winnerPlayer && winnerPlayer.socketId) io.to(winnerPlayer.socketId).emit('win_notification', result.settlementData);
        else io.to(gameId).emit('win_notification', result.settlementData);
      }

      const gameRecord = await Game.findOne({ gameId });
      if (gameRecord && gameRecord.status === 'ACTIVE') {
        const nextPlayer = gameRecord.players[gameRecord.currentPlayerIndex];

        if (gameRecord.turnState === 'ROLLING') {
          // Next player's turn to roll
          if (nextPlayer && (nextPlayer.isAI || nextPlayer.isDisconnected)) {
            console.log(`[MOVE] Scheduling auto-turn for AI/disconnected player ${nextPlayer.color}`);
            scheduleAutoTurn(gameId);
          } else if (nextPlayer) {
            console.log(`[MOVE] Scheduling human auto-roll timer for ${nextPlayer.color}`);
            scheduleHumanPlayerAutoRoll(gameId);
          }
        } else if (gameRecord.turnState === 'MOVING') {
          // Current player still has moves to make (e.g., rolled 6 or multiple legal moves)
          if (nextPlayer && (nextPlayer.isAI || nextPlayer.isDisconnected)) {
            console.log(`[MOVE] AI/disconnected player ${nextPlayer.color} in MOVING state, scheduling auto-move`);
            scheduleAutoTurn(gameId, AUTO_TURN_DELAYS.AI_MOVE);
          } else if (nextPlayer) {
            console.log(`[MOVE] Human player ${nextPlayer.color} in MOVING state, scheduling auto-move timer`);
            scheduleHumanPlayerAutoMove(gameId);
          }
        } else {
          console.log(`[MOVE] Game ${gameId} in unexpected state: ${gameRecord.turnState}`);
        }
      }
    } else {
      socket.emit('ERROR', { message: result.message });

      // CRITICAL FIX: Restart timer if move failed

      const gameCheck = await Game.findOne({ gameId });
      if (gameCheck && gameCheck.status === 'ACTIVE' && gameCheck.turnState === 'MOVING') {
        const currentPlayer = gameCheck.players[gameCheck.currentPlayerIndex];
        if (currentPlayer && currentPlayer.socketId === socket.id) {
          console.log(`[SOCKET] Restarting move timer for ${currentPlayer.color} after failed move`);
          scheduleHumanPlayerAutoMove(gameId);
        }
      }
    }
  });

  socket.on('admin_force_roll', async ({ gameId, targetColor, diceValue }) => {
    console.log(`👮 SOCKET: admin_force_roll attempt for game ${gameId}. Target: ${targetColor}, Value: ${diceValue}`);
    try {
      // 🔒 SECURITY CHECK: Only Admins can force rolls
      const userId = socket.data.userId;
      if (!userId) return socket.emit('ERROR', { message: 'Authentication required' });

      const user = await User.findById(userId);
      if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN')) {
        console.warn(`🚨 Unauthorized force_roll attempt by user ${user?.username || userId}`);
        return socket.emit('ERROR', { message: 'Access denied.' });
      }

      const game = await Game.findOne({ gameId });
      if (game) {
        if (!game.forcedRolls) {
          game.forcedRolls = {}; // Initialize if missing (though schema default handles it)
        }

        // Handle Mongoose Map or POJO
        if (game.forcedRolls instanceof Map) {
          game.forcedRolls.set(targetColor, Number(diceValue));
        } else {
          // Fallback if somehow it's just an object
          game.forcedRolls[targetColor] = Number(diceValue);
        }

        game.markModified('forcedRolls');
        await game.save();
        console.log(`✅ Forced roll saved. Next roll for ${targetColor} will be ${diceValue}`);
        socket.emit('admin_ack', { message: `Force roll set: ${diceValue} for ${targetColor}` });
      }
    } catch (e) {
      console.error('Error setting forced roll:', e);
    }
  });

  // ===== GEM RE-ROLL SYSTEM =====
  socket.on('use_gem_reroll', async ({ gameId, userId }) => {
    console.log(`💎 GEM RE-ROLL REQUEST from ${socket.id} for game ${gameId}`);
    try {
      // ✅ FIX: Accept userId from payload, fallback to socket.data
      const effectiveUserId = userId || socket.data.userId;
      if (!effectiveUserId) {
        console.warn(`⚠️ [GEM] Unauthorized re-roll attempt from socket ${socket.id}`);
        return socket.emit('ERROR', { message: 'Authentication required' });
      }

      const user = await User.findById(effectiveUserId);
      if (!user) {
        console.error(`❌ [GEM] User ${effectiveUserId} not found for re-roll`);
        return socket.emit('ERROR', { message: 'User not found' });
      }

      // Ensure fields are never NaN
      if (isNaN(user.gems)) user.gems = 0;
      if (isNaN(user.balance)) user.balance = 0;

      // Check gem balance (1 gem = $0.01)
      const GEM_COST = 1;
      if ((user.gems || 0) < GEM_COST) {
        console.log(`❌ [GEM] User ${effectiveUserId} insufficient gems: ${user.gems}`);
        return socket.emit('ERROR', { message: 'Insufficient gems. Purchase gems to use re-roll.' });
      }

      const game = await Game.findOne({ gameId });
      if (!game || game.status !== 'ACTIVE') {
        console.warn(`⚠️ [GEM] Game ${gameId} not found or not active for re-roll`);
        return socket.emit('ERROR', { message: 'Game not found or not active' });
      }

      // Verify it's this player's turn
      const currentPlayer = game.players[game.currentPlayerIndex];
      if (!currentPlayer || String(currentPlayer.userId) !== String(effectiveUserId)) {
        console.warn(`⚠️ [GEM] User ${effectiveUserId} tried to re-roll on someone else's turn`);
        return socket.emit('ERROR', { message: 'Not your turn' });
      }

      // turnState must be MOVING (after roll) or ROLLING (if no moves possible)
      // but usually after a roll they are in MOVING or the backend might have passed turn if no moves.
      if (game.turnState === 'ROLLING' && game.diceValue === null) {
        return socket.emit('ERROR', { message: 'Roll the dice first before re-rolling!' });
      }

      // Check re-roll limit (max 4 per game per player)
      const MAX_REROLLS = 4;
      let rerollCount = 0;
      if (game.rerollsUsed) {
        if (game.rerollsUsed instanceof Map) {
          rerollCount = game.rerollsUsed.get(effectiveUserId) || 0;
        } else {
          rerollCount = game.rerollsUsed[effectiveUserId] || 0;
        }
      }

      if (rerollCount >= MAX_REROLLS) {
        return socket.emit('ERROR', { message: '4 tii jeer ee lagugu tala galay way kaa dhamaatay xadkii lagugu tala galay' });
      }

      // Deduct gem from user
      user.gems = (user.gems || 0) - GEM_COST;
      user.transactions.push({
        type: 'gem_usage',
        amount: -GEM_COST,
        matchId: gameId,
        description: `Used gem for re-roll in game ${gameId}`,
        createdAt: new Date()
      });
      await user.save();

      // Update re-roll count
      if (!game.rerollsUsed) {
        game.rerollsUsed = new Map();
      }
      if (game.rerollsUsed instanceof Map) {
        game.rerollsUsed.set(effectiveUserId, rerollCount + 1);
      } else {
        game.rerollsUsed[effectiveUserId] = rerollCount + 1;
      }

      // Grant re-roll: Reset turn state to ROLLING
      game.turnState = 'ROLLING';
      game.diceValue = null;
      game.legalMoves = [];
      game.message = `${currentPlayer.username || currentPlayer.color} used a gem to Undo! 💎`;
      game.timer = 7; // Reset timer for roll

      game.markModified('rerollsUsed');
      await game.save();

      console.log(`✅ Gem Undo granted to ${effectiveUserId}. Gems remaining: ${user.gems}, Undos used: ${rerollCount + 1}/${MAX_REROLLS}`);

      // Emit updated game state using helper for proper serialization
      io.to(gameId).emit('GAME_STATE_UPDATE', { state: prepareGameStateForEmit(game) });

      // Emit gem update to player
      socket.emit('gem_reroll_success', {
        gemsRemaining: user.gems,
        rerollsUsed: rerollCount + 1,
        rerollsRemaining: MAX_REROLLS - (rerollCount + 1)
      });

      // Restart turn timer
      if (!currentPlayer.isAI && !currentPlayer.isDisconnected) {
        scheduleHumanPlayerAutoRoll(gameId);
      }

    } catch (error) {
      console.error('❌ [GEM] Gem re-roll error:', error);
      socket.emit('ERROR', { message: 'Failed to process gem re-roll' });
    }
  });

  socket.on('send_chat_message', async ({ gameId, userId, message }) => {
    try {
      if (!gameId || !userId) return;

      const game = await Game.findOne({ gameId });
      if (game) {
        const player = game.players.find(p => p.userId === userId);
        if (player) {
          const chatData = { userId, playerColor: player.color, playerName: player.username || player.userId, message, timestamp: Date.now() };
          io.to(gameId).emit('chat_message', chatData);
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
    }
  });

  // Client-side UN-STICK Request
  socket.on('resync_game', async ({ gameId }) => {
    console.log(`🔄 RESYNC REQUEST from ${socket.id} for game ${gameId}`);
    try {
      const game = await Game.findOne({ gameId });
      if (game) {
        socket.emit('GAME_STATE_UPDATE', { state: prepareGameStateForEmit(game) });

        // Check if we need to restart a dead timer
        const currentPlayer = game.players[game.currentPlayerIndex];
        const isMyTurn = currentPlayer && currentPlayer.socketId === socket.id;

        if (isMyTurn && !humanPlayerTimers.has(gameId)) {
          console.log(`🔧 Resync triggered Timer Restart for ${gameId}`);
          if (game.turnState === 'ROLLING') scheduleHumanPlayerAutoRoll(gameId);
          else if (game.turnState === 'MOVING') scheduleHumanPlayerAutoMove(gameId);
        }
      } else {
        socket.emit('ERROR', { message: 'Game not found during resync' });
      }
    } catch (e) {
      console.error('Resync error:', e);
      if (socket.gameId) {
        const gameId = socket.gameId;

        const game = await Game.findOne({ gameId });
        if (game) {
          const player = game.players.find(p => p.socketId === socket.id);
          if (player && player.userId) {
            const userIdString = String(player.userId); // STANDARD: Use string for map keys
            const disconnectTimeout = setTimeout(async () => {
              pendingDisconnects.delete(userIdString);
              if (typeof clearAllTimersForGame === 'function') clearAllTimersForGame(gameId);
              const result = await gameEngine.handleDisconnect(gameId, socket.id);
              if (result) {
                io.to(gameId).emit('GAME_STATE_UPDATE', { state: prepareGameStateForEmit(result.state) });
                if (result.isCurrentTurn) scheduleAutoTurn(gameId, AUTO_TURN_DELAYS.AI_ROLL);
              }

            }, 15000); // 15s to match standard
            pendingDisconnects.set(userIdString, { timeoutId: disconnectTimeout, gameId });
            console.log(`⏱️ Player ${player.color} (${userIdString}) disconnected during resync error. Timeout set (15s)`);
            return;
          }
        }
        if (typeof clearAllTimersForGame === 'function') clearAllTimersForGame(gameId);
        const result = await gameEngine.handleDisconnect(gameId, socket.id);
        if (result) {
          io.to(gameId).emit('GAME_STATE_UPDATE', { state: prepareGameStateForEmit(result.state) });

          const hasConnectedHuman = result.state.players.some(p => p.userId && !p.isAI && !p.isDisconnected && p.socketId);

          if (!hasConnectedHuman) {
            console.log(`🤖 Game ${gameId} - No active humans. Bots playing in SLOW MODE.`);
            if (result.isCurrentTurn) scheduleAutoTurn(gameId, 8000);
          } else {
            if (result.isCurrentTurn) scheduleAutoTurn(gameId, AUTO_TURN_DELAYS.AI_ROLL);
          }
        }

      }
    }
  });

  // ===== REMATCH SYSTEM =====
  // Track pending rematch requests: gameId -> { requesterId, requesterColor, stakeAmount, opponentId, timeout }
  const rematchRequests = new Map();

  socket.on('request_rematch', async ({ gameId, stakeAmount }) => {
    console.log(`🔄 REMATCH REQUEST from ${socket.id} for game ${gameId}`);
    try {
      const game = await Game.findOne({ gameId });
      if (!game || game.status !== 'COMPLETED') {
        return socket.emit('ERROR', { message: 'Game not found or not completed' });
      }

      // Find the player who requested rematch
      const requester = game.players.find(p => p.socketId === socket.id);
      if (!requester) {
        return socket.emit('ERROR', { message: 'You are not a player in this game' });
      }

      const opponent = game.players.find(p => p.userId !== requester.userId);
      if (!opponent) {
        return socket.emit('ERROR', { message: 'Opponent not found' });
      }

      // Check if requester has sufficient balance
      const user = await User.findById(requester.userId);
      if (!user || Math.round(user.balance * 100) < Math.round(stakeAmount * 100)) {
        return socket.emit('ERROR', { message: 'Insufficient balance for rematch' });
      }

      // Store rematch request
      rematchRequests.set(gameId, {
        requesterId: requester.userId,
        requesterColor: requester.color,
        requesterSocketId: socket.id,
        opponentId: opponent.userId,
        opponentSocketId: opponent.socketId,
        stakeAmount: stakeAmount || game.stake,
        expiresAt: Date.now() + 30000
      });

      // Notify opponent
      io.to(gameId).emit('rematch_requested', {
        requesterId: requester.userId,
        requesterColor: requester.color
      });

      // Set timeout to auto-decline after 30 seconds
      setTimeout(() => {
        const request = rematchRequests.get(gameId);
        if (request) {
          rematchRequests.delete(gameId);
          // Emit decline to both players
          io.to(gameId).emit('rematch_declined', { reason: 'timeout' });
          console.log(`⏰ Rematch request for ${gameId} timed out`);
        }
      }, 30000);

    } catch (error) {
      console.error('Rematch request error:', error);
      socket.emit('ERROR', { message: 'Failed to request rematch' });
    }
  });

  socket.on('accept_rematch', async ({ gameId }) => {
    console.log(`✅ REMATCH ACCEPTED from ${socket.id} for game ${gameId}`);
    try {
      const request = rematchRequests.get(gameId);
      if (!request) {
        return socket.emit('ERROR', { message: 'No pending rematch request' });
      }

      const game = await Game.findOne({ gameId });
      if (!game) {
        return socket.emit('ERROR', { message: 'Original game not found' });
      }

      // Find the acceptor (should be the opponent)
      const acceptor = game.players.find(p => p.socketId === socket.id);
      if (!acceptor || acceptor.userId === request.requesterId) {
        return socket.emit('ERROR', { message: 'Invalid acceptor' });
      }

      // DUPLICATE MATCH PREVENTION: Check if acceptor is already in an active game
      const acceptorActiveGame = await Game.findOne({ status: 'ACTIVE', 'players.userId': acceptor.userId });
      if (acceptorActiveGame) {
        return socket.emit('ERROR', { message: 'You are already in an active game.' });
      }

      // Check both players have sufficient balance for the rematch
      const requesterUser = await User.findById(request.requesterId);
      const acceptorUser = await User.findById(acceptor.userId);

      const stake = request.stakeAmount;

      if (!requesterUser || Math.round(requesterUser.balance * 100) < Math.round(stake * 100)) {
        rematchRequests.delete(gameId);
        io.to(gameId).emit('rematch_declined', { reason: 'requester_insufficient_funds' });
        return;
      }

      if (!acceptorUser || Math.round(acceptorUser.balance * 100) < Math.round(stake * 100)) {
        rematchRequests.delete(gameId);
        socket.emit('ERROR', { message: 'Insufficient balance for rematch' });
        return;
      }

      // Clear the request
      rematchRequests.delete(gameId);

      // Create a new match between the two players
      const requesterPlayer = game.players.find(p => p.userId === request.requesterId);

      const player1 = {
        socketId: request.requesterSocketId,
        userId: request.requesterId,
        userName: requesterPlayer?.username || requesterUser.username
      };

      const player2 = {
        socketId: socket.id,
        userId: acceptor.userId,
        userName: acceptor.username || acceptorUser.username
      };

      console.log(`🎮 Creating rematch game between ${player1.userName} and ${player2.userName} for $${stake}`);

      // Use existing createMatch function and get the new ID
      const newGameId = await createMatch(player1, player2, stake);

      // Emit rematch accepted so frontend can handle transition
      // CRITICAL: Include the newGameId so both players know where to go
      io.to(gameId).emit('rematch_accepted', {
        newGameId: newGameId,
        stakeAmount: stake,
        message: 'Rematch starting...'
      });

    } catch (error) {
      console.error('Accept rematch error:', error);
      socket.emit('ERROR', { message: 'Failed to accept rematch' });
    }
  });

  socket.on('decline_rematch', async ({ gameId }) => {
    console.log(`❌ REMATCH DECLINED from ${socket.id} for game ${gameId}`);
    try {
      const request = rematchRequests.get(gameId);
      if (request) {
        // Clear the request
        rematchRequests.delete(gameId);

        // Notify the requester that rematch was declined
        if (request.requesterSocketId) {
          io.to(request.requesterSocketId).emit('rematch_declined', { reason: 'declined' });
          io.to(request.requesterSocketId).emit('rematch_searching', {
            message: 'Searching for new opponent with same stake...',
            stakeAmount: request.stakeAmount
          });

          // Create a new match request for the original requester
          const requesterUser = await User.findById(request.requesterId);
          if (requesterUser && Math.round(requesterUser.balance * 100) >= Math.round(request.stakeAmount * 100)) {
            // Create match request so they can find another player
            const requestId = crypto.randomBytes(8).toString('hex');
            const expiresAt = Date.now() + 120000;

            const newRequest = {
              requestId,
              userId: request.requesterId,
              userName: requesterUser.username,
              stake: request.stakeAmount,
              socketId: request.requesterSocketId,
              expiresAt,
              createdAt: Date.now()
            };
            activeMatchRequests.set(requestId, newRequest);

            const timer = setTimeout(() => {
              activeMatchRequests.delete(requestId);
              requestTimers.delete(requestId);
              const creatorSocket = io.sockets.sockets.get(newRequest.socketId);
              if (creatorSocket) {
                creatorSocket.emit('match_request_expired', { requestId });
              }
              io.emit('match_request_removed', { requestId });
            }, 120000);
            requestTimers.set(requestId, timer);

            // Notify the requester their request is created
            io.to(request.requesterSocketId).emit('match_request_created', { requestId });

            // Broadcast to other potential players
            const broadcastRequest = {
              requestId,
              userId: request.requesterId,
              userName: requesterUser.username,
              stake: request.stakeAmount,
              timeRemaining: 120
            };
            io.emit('new_match_request', { request: broadcastRequest });

            console.log(`🔍 Created new match request for ${requesterUser.username} after rematch decline`);
          }
        }

        // Also notify the decliner's socket
        socket.emit('rematch_declined', { reason: 'self_declined' });
      }
    } catch (error) {
      console.error('Decline rematch error:', error);
    }
  });

  socket.on('rematch_timeout', async ({ gameId }) => {
    console.log(`⏰ REMATCH TIMEOUT from ${socket.id} for game ${gameId}`);
    const request = rematchRequests.get(gameId);
    if (request) {
      rematchRequests.delete(gameId);
      io.to(gameId).emit('rematch_declined', { reason: 'timeout' });
    }
  });

  socket.on('get_active_requests', ({ userId }) => {
    // Send Ludo requests
    const requests = Array.from(activeMatchRequests.values()).map(req => ({
      requestId: req.requestId,
      userId: req.userId,
      userName: req.userName,
      stake: req.stake,
      timeRemaining: Math.max(0, Math.ceil((req.expiresAt - Date.now()) / 1000)),
      canAccept: true // Simplified, frontend does balance check
    }));
    socket.emit('active_requests', { requests });

    // Send TTT requests
    if (typeof ticTacToeQueue !== 'undefined') {
      socket.emit('active_ttt_requests', ticTacToeQueue.map(p => ({
        userId: p.userId,
        username: p.username,
        stake: p.stake,
        requestId: p.socketId,
        isTTT: true
      })));
    }
  });

  socket.on('disconnect', async () => {
    // Keep removing from matchmaking queue logic
    removeFromQueue(socket.id);

    // TTT Queue Removal
    if (typeof ticTacToeQueue !== 'undefined') {
      const tttIndex = ticTacToeQueue.findIndex(p => p.socketId === socket.id);
      if (tttIndex !== -1) {
        console.log(`🔌 Removing disconnected player from TTT queue: ${socket.id}`);
        ticTacToeQueue.splice(tttIndex, 1);
        io.emit('active_ttt_requests', ticTacToeQueue.map(p => ({
          userId: p.userId,
          username: p.username,
          stake: p.stake,
          requestId: p.socketId,
          isTTT: true
        })));
      }
    }

    if (socket.gameType === 'TIC_TAC_TOE' && socket.gameId) {
      console.log(`🔌 TTT Socket ${socket.id} disconnected from game ${socket.gameId}`);
      try {
        const result = await ticTacToeEngine.handleDisconnect(socket.gameId, socket.id);
        if (result && result.success) {
          io.to(socket.gameId).emit('ttt_game_update', result.state);
          // Check if game ended due to disconnect (forfeit)
          if (result.settlementData) {
            // Notify winner if possible
            // io.to(...).emit('win_notification'...) logic handles this via game update state checks usually
          }
        }
      } catch (e) {
        console.error('Error handling TTT disconnect:', e);
      }
      return; // Exit main flow logic for TTT
    }

    if (socket.gameId) {
      const gameId = socket.gameId;
      console.log(`📡 Socket ${socket.id} disconnected from game ${gameId}`);

      try {
        const game = await Game.findOne({ gameId });
        if (game && game.status === 'ACTIVE') {
          const player = game.players.find(p => p.socketId === socket.id);
          if (player && player.userId) {
            const userIdString = String(player.userId); // STANDARD: Use string for map keys

            // Clear any existing timeout for this user (prevent duplicate timers)
            if (pendingDisconnects.has(userIdString)) {
              clearTimeout(pendingDisconnects.get(userIdString).timeoutId);
            }

            const disconnectTimeout = setTimeout(async () => {
              pendingDisconnects.delete(userIdString);
              if (typeof clearAllTimersForGame === 'function') clearAllTimersForGame(gameId);

              const result = await gameEngine.handleDisconnect(gameId, socket.id);
              if (result) {
                io.to(gameId).emit('GAME_STATE_UPDATE', { state: prepareGameStateForEmit(result.state) });
                if (result.isCurrentTurn) scheduleAutoTurn(gameId, AUTO_TURN_DELAYS.AI_ROLL);
              }
              console.log(`🤖 Disconnect timeout reached for ${player.color} in ${gameId}. Bot taking over.`);
            }, 15000);

            pendingDisconnects.set(userIdString, { timeoutId: disconnectTimeout, gameId });
            console.log(`⏱️ Player ${player.color} (${userIdString}) disconnected. Timeout set (15s) for game ${gameId}`);
            return;
          }
        }

        // Handle immediate disconnect if game not active or player not found
        if (typeof clearAllTimersForGame === 'function') clearAllTimersForGame(gameId);
        const result = await gameEngine.handleDisconnect(gameId, socket.id);
        if (result) {
          io.to(gameId).emit('GAME_STATE_UPDATE', { state: prepareGameStateForEmit(result.state) });
          if (result.isCurrentTurn) scheduleAutoTurn(gameId, AUTO_TURN_DELAYS.AI_ROLL);
        }
      } catch (err) {
        console.error('Error handling disconnect:', err);
      }
    }
  });
});

// Scheduled Task: Cleanup Stale Games (Every 6 Hours)
setInterval(async () => {
  try {

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Find games that are 'ACTIVE' but haven't been updated in 24 hours
    const staleGames = await Game.find({
      status: 'ACTIVE',
      updatedAt: { $lt: twentyFourHoursAgo }
    });

    if (staleGames.length > 0) {
      console.log(`🧹 Found ${staleGames.length} stale games to clean up and refund...`);
      for (const game of staleGames) {
        const stake = game.stake;
        if (stake > 0) {
          for (const player of game.players) {
            if (player.userId && !player.isAI) {
              try {
                const user = await User.findById(player.userId);
                if (user) {
                  // UNCONDITIONAL REFUND: If the game was ACTIVE, the money was deducted.
                  // We must give it back. We don't care about reservedBalance state.
                  user.balance = roundCurrency(user.balance + stake);
                  user.reservedBalance = Math.max(0, (user.reservedBalance || 0) - stake);

                  user.transactions.push({
                    type: 'game_refund',
                    amount: stake,
                    matchId: game.gameId,
                    description: `Refund for stale/cancelled game ${game.gameId}`
                  });
                  await user.save();
                  console.log(`💰 Refunded ${stake} to user ${user.username} for stale game ${game.gameId}.`);
                }
              } catch (refundError) {
                console.error(`❌ Error refunding user ${player.userId} for stale game ${game.gameId}:`, refundError);
              }
            }
          }
        }
        // After attempting refunds, delete the game
        await Game.deleteOne({ _id: game._id });
      }
      console.log(`✅ Finished cleaning up ${staleGames.length} stale games.`);
    }
  } catch (err) {
    console.error('Game cleanup error:', err);
  }
}, 6 * 60 * 60 * 1000);

// Serve frontend static build when present (same-domain deployment)
try {
  const frontendDist = path.join(__dirname, '..', 'dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get('/:path*', (req, res) => {
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
    console.log('✅ Serving frontend from', frontendDist);
  } else {
    console.log('ℹ️ Frontend dist not found at', frontendDist);
  }
} catch (e) {
  console.warn('⚠️ Error checking frontend dist:', e.message);
}


const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0'; // Listen on all network interfaces for mobile access

// Startup Cleanup: Mark all players as disconnected in ACTIVE games
const performStartupCleanup = async () => {
  try {
    console.log('🧹 Performing startup cleanup...');

    // 1. Mark disconnected (standard procedure)
    const result = await Game.updateMany(
      { status: 'ACTIVE' },
      {
        $set: {
          'players.$[].isDisconnected': true,
          'players.$[].socketId': null
        }
      }
    );
    console.log(`✅ Startup cleanup complete: Marked players as disconnected in ${result.modifiedCount} active games.`);

    // 2. RESTORE TIMERS (New Reliability Feat)
    await restoreTimersForActiveGames();

  } catch (err) {
    console.error('⚠️ Startup cleanup failed (non-critical):', err && err.message ? err.message : err);
  }
};

// --- RESTORE TIMERS FOR ACTIVE GAMES ---
const restoreTimersForActiveGames = async () => {
  try {
    console.log('⏰ Restoring timers for ACTIVE games...');
    const activeGames = await Game.find({ status: 'ACTIVE' });

    for (const game of activeGames) {
      console.log(`❤️ Restoring game ${game.gameId} (State: ${game.turnState})`);

      const currentPlayer = game.players[game.currentPlayerIndex];
      if (!currentPlayer) continue;

      // If it was an AI turn, schedule AI turn
      if (currentPlayer.isAI) {
        scheduleAutoTurn(game.gameId, AUTO_TURN_DELAYS.AI_ROLL);
        continue;
      }

      // If it was a human turn, we must assume they are disconnected now (since server restarted)
      // But if we want to give them a chance to reconnect, we might wait.
      // However, 'performStartupCleanup' just marked them disconnected.
      // So we should actually schedule an AUTO TURN for them (bot takeover).

      // BUT, if users reconnect quickly, we want the game to be alive.
      // Let's schedule a "Recovery Auto Turn" that gives a bit of grace period (e.g. 5s)
      scheduleAutoTurn(game.gameId, 5000);
    }
    console.log(`✅ Restored timers/recovery for ${activeGames.length} active games.`);
  } catch (e) {
    console.error('Timer restoration failed:', e);
  }
};

// --- Lightweight Watchdog (Optimized for Speed) ---
// Checks every 5 seconds for games stuck > 10s
setInterval(async () => {
  try {

    const gameEngine = require('./logic/gameEngine');
    const now = Date.now();
    const stalledThreshold = 60000; // 60 seconds (Relaxed to prevent conflicting timer kicks)

    const activeGames = await Game.find({ status: 'ACTIVE' });

    for (const game of activeGames) {
      const lastActivity = game.updatedAt ? new Date(game.updatedAt).getTime() : 0;
      const isStalled = (now - lastActivity) > stalledThreshold;

      if (isStalled) {
        const currentPlayer = game.players[game.currentPlayerIndex];
        if (!currentPlayer) continue;

        // Check if we already have a timer for this game
        const hasTimer = humanPlayerTimers.has(game.gameId);

        // If it's stalled and NO TIMER is running, it's definitely stuck.
        // If a timer IS running, it might just be a long turn (but our max turn is 12s, threshold is 10s -- close call)
        // With move timer 12s, we should set threshold to ~15s to be safe? 
        // Let's stick to 12s check.

        if (isStalled && !hasTimer) {
          console.log(`🐕 Watchdog: Kickstarting frozen game ${game.gameId} (No timer found)`);

          if (currentPlayer.isAI || currentPlayer.isDisconnected) {
            scheduleAutoTurn(game.gameId, 100);
          } else {
            // Try to revive human timer first
            if (game.turnState === 'ROLLING') scheduleHumanPlayerAutoRoll(game.gameId);
            else if (game.turnState === 'MOVING') scheduleHumanPlayerAutoMove(game.gameId);
          }
        } else if (isStalled && hasTimer) {
          // Timer exists but db not updating? Might be okay, just waiting for move.
          // But if it's > 20s, then even the timer is dead/ignored.
          if ((now - lastActivity) > 20000) {
            console.log(`🐕 Watchdog: FORCE KICK - Game ${game.gameId} stalled > 20s despite timer.`);
            // Force next action
            if (game.turnState === 'ROLLING') await gameEngine.handleAutoRoll(game.gameId, true);
            else await gameEngine.handleAutoMove(game.gameId);

            // Broadast
            const updatedGame = await Game.findOne({ gameId: game.gameId });
            if (updatedGame) io.to(game.gameId).emit('GAME_STATE_UPDATE', { state: prepareGameStateForEmit(updatedGame) });
          }
        }
      }
    }
  } catch (error) {
    console.error('Watchdog error:', error);
  }
}, 5000); // Check every 5s

// --- Auto-Delete Old Pending Requests ---
// Runs every 15 minutes to clean up pending requests older than 1 hour
// Only deletes PENDING requests - APPROVED and REJECTED requests are not affected
setInterval(async () => {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago

    const result = await FinancialRequest.deleteMany({
      status: 'PENDING',
      timestamp: { $lt: oneHourAgo }
    });

    if (result.deletedCount > 0) {
      console.log(`🧹 Auto-cleanup: Deleted ${result.deletedCount} pending request(s) older than 1 hour`);
    }
  } catch (error) {
    console.error('❌ Pending requests cleanup error:', error);
  }
}, 15 * 60 * 1000); // Run every 15 minutes

// Start server after ensuring DB connection and performing startup cleanup.
(async () => {
  try {
    await ensureMongoConnect();
  } catch (err) {
    console.error('⚠️ ensureMongoConnect() error:', err && err.message ? err.message : err);
  }

  try {
    await performStartupCleanup();
    console.log('✅ Startup cleanup completed');
  } catch (err) {
    console.error('⚠️ Startup cleanup failed:', err);
    console.log('🔄 Continuing server startup...');
  }

  // Mount referral routes
  const referralRoutes = require('./referralRoutes');
  app.use('/api/referrals', authenticateToken, referralRoutes);

  // Admin Quick Actions routes
  const adminQuickActionsRoutes = require('./routes/adminQuickActions');
  app.use('/api/admin/quick', authenticateToken, authorizeQuickAdmin, adminQuickActionsRoutes);

  // Analytics Routes
  const analyticsRoutes = require('./routes/analyticsRoutes');
  app.use('/api/admin/analytics', authenticateToken, authorizeAdmin, analyticsRoutes);

  const todayAnalyticsRoutes = require('./routes/todayAnalyticsRoutes');
  // Note: todayAnalyticsRoutes uses the same base path, and authorizeAdmin is now applied
  // to everything under /api/admin/analytics via the above mounting.
  // But for clarity and explicit protection:
  app.use('/api/admin/analytics', authenticateToken, authorizeAdmin, todayAnalyticsRoutes);
  // --- SOCKET.IO HANDLERS (RESTORED TIC-TAC-TOE ONLY) ---
  io.on('connection', (socket) => {
    // Ludo socket handlers were duplicated here and have been removed.
    // They are correctly defined in the primary io.on('connection', ...) block above.

    // ========== TIC-TAC-TOE SOCKET HANDLERS ==========
    const ticTacToeEngine = require('./logic/ticTacToeEngine');
    const TicTacToeGame = require('./models/TicTacToeGame');

    socket.on('ttt_join_game', async ({ gameId, userId, sessionId }) => {
      try {
        console.log(`🎮 Player ${userId} joining tic-tac-toe game ${gameId}`);
        const result = await ticTacToeEngine.handleJoinGame(gameId, userId, socket.id);

        if (result.success) {
          socket.join(gameId);
          socket.gameId = gameId; // Track for disconnect
          socket.gameType = 'TIC_TAC_TOE'; // Track game type

          const plainState = result.state.toObject ? result.state.toObject() : result.state;
          io.to(gameId).emit('ttt_game_update', plainState);
          console.log(`✅ Player ${userId} joined tic-tac-toe game ${gameId}`);

          // If both players have joined, start the game
          const game = await TicTacToeGame.findOne({ gameId });
          if (game && game.players.length === 2 && game.status === 'WAITING') {
            game.status = 'ACTIVE';
            game.gameStarted = true;
            game.message = `Game started! ${game.players[0].username}'s turn`;
            await game.save();

            const updatedState = game.toObject ? game.toObject() : game;
            io.to(gameId).emit('ttt_game_update', updatedState);
            console.log(`🎲 Tic-tac-toe game ${gameId} started`);
          }
        } else {
          socket.emit('ttt_error', { message: result.message });
        }
      } catch (error) {
        console.error('Error joining tic-tac-toe game:', error);
        socket.emit('ttt_error', { message: 'Failed to join game' });
      }
    });

    socket.on('ttt_make_move', async ({ gameId, row, col }) => {
      try {
        console.log(`📤 Tic-tac-toe move in game ${gameId}: row=${row}, col=${col}`);
        const result = await ticTacToeEngine.handleMakeMove(gameId, socket.id, row, col);

        if (result.success) {
          const plainState = result.state.toObject ? result.state.toObject() : result.state;
          io.to(gameId).emit('ttt_game_update', plainState);

          // Send win notification if game completed with winner
          if (result.settlementData) {
            const winnerPlayer = plainState.players.find(
              p => p.userId === result.settlementData.winnerId
            );

            if (winnerPlayer && winnerPlayer.socketId) {
              io.to(winnerPlayer.socketId).emit('win_notification', result.settlementData);
              console.log(`🎉 Win notification sent to ${winnerPlayer.username}`);
            }
          }

          // If game ended in draw, notify players
          if (plainState.winner === 'DRAW') {
            io.to(gameId).emit('game_draw', {
              message: 'Game ended in a draw! Stakes refunded.'
            });
          }
        } else {
          socket.emit('ttt_error', { message: result.message });
        }
      } catch (error) {
        console.error('Error making tic-tac-toe move:', error);
        socket.emit('ttt_error', { message: 'Failed to make move' });
      }
    });
    // ========== END TIC-TAC-TOE HANDLERS ==========

    // ========== TIC-TAC-TOE MATCHMAKING ==========
    // Global queue for separate TTT matchmaking
    // MOVED TO GLOBAL SCOPE
    // const ticTacToeQueue = [];

    socket.on('ttt_find_match', async ({ userId, username, stake }) => {
      try {
        console.log(`🔎 Player ${username} looking for TTT match with stake ${stake}`);

        // Remove existing if any
        const existingIndex = ticTacToeQueue.findIndex(p => p.userId === userId);
        if (existingIndex !== -1) {
          ticTacToeQueue.splice(existingIndex, 1);
        }

        // Add to queue
        const player = { userId, username, socketId: socket.id, stake };
        ticTacToeQueue.push(player);
        console.log(`TTT Queue length: ${ticTacToeQueue.length}`);

        // Matchmaking
        if (ticTacToeQueue.length >= 2) {
          // Get first two players
          const p1 = ticTacToeQueue.shift();
          const p2 = ticTacToeQueue.shift();

          // Generate ID
          const gameId = 'ttt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

          console.log(`🤝 Matching ${p1.username} vs ${p2.username} in game ${gameId}`);

          // Creates game in DB
          const result = await ticTacToeEngine.createGame(gameId, [
            { userId: p1.userId, username: p1.username },
            { userId: p2.userId, username: p2.username }
          ], stake);

          if (result.success) {
            // Notify P1
            io.to(p1.socketId).emit('ttt_match_found', {
              gameId,
              stake,
              yourSymbol: 'X',
              players: result.game.players
            });

            // Notify P2
            io.to(p2.socketId).emit('ttt_match_found', {
              gameId,
              stake,
              yourSymbol: 'O',
              players: result.game.players
            });

            console.log(`✅ TTT Match created & notified: ${gameId}`);

            // Broadcast queue update (players removed)
            io.emit('active_ttt_requests', ticTacToeQueue.map(p => ({
              userId: p.userId,
              username: p.username,
              stake: p.stake,
              requestId: p.socketId,
              isTTT: true
            })));

          } else {
            console.error('Failed to create TTT game:', result.message);
            socket.emit('ttt_error', { message: 'Failed to create match' });
          }
        } else {
          // No match yet - waiting in queue
          // Broadcast queue update (new player added)
          io.emit('active_ttt_requests', ticTacToeQueue.map(p => ({
            userId: p.userId,
            username: p.username,
            stake: p.stake,
            requestId: p.socketId,
            isTTT: true
          })));
        }
      } catch (err) {
        console.error('Error in TTT matchmaking:', err);
      }
    });

    // ========== TIC-TAC-TOE REMATCH HANDLERS ==========
    socket.on('ttt_request_rematch', async ({ gameId }) => {
      try {
        console.log(`🔄 Rematch requested for game ${gameId} by ${socket.id}`);

        // Get current game to find players
        const game = await TicTacToeGame.findOne({ gameId });
        if (!game) {
          socket.emit('ttt_error', { message: 'Game not found' });
          return;
        }

        // Find which user is requesting
        const requestingPlayer = game.players.find(p => p.socketId === socket.id);
        if (!requestingPlayer) {
          socket.emit('ttt_error', { message: 'You are not in this game' });
          return;
        }

        // Initialize rematch tracking for this game if needed
        if (!rematchRequests.has(gameId)) {
          rematchRequests.set(gameId, new Set());
        }

        const requests = rematchRequests.get(gameId);
        requests.add(requestingPlayer.userId);

        // Notify opponent
        const opponent = game.players.find(p => p.userId !== requestingPlayer.userId);
        if (opponent?.socketId) {
          io.to(opponent.socketId).emit('ttt_rematch_requested', { userId: requestingPlayer.userId });
        }

        // Check if both players want rematch
        if (requests.size === 2) {
          console.log(`✅ Both players want rematch for ${gameId}, creating new game`);

          // Create new game with same players
          const newGameId = 'ttt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
          const result = await ticTacToeEngine.createGame(newGameId, [
            { userId: game.players[0].userId, username: game.players[0].username },
            { userId: game.players[1].userId, username: game.players[1].username }
          ], game.stake);

          if (result.success) {
            // Clean up old rematch requests
            rematchRequests.delete(gameId);

            // Notify both players
            game.players.forEach((player, index) => {
              if (player.socketId) {
                io.to(player.socketId).emit('ttt_rematch_start', {
                  gameId: newGameId,
                  yourSymbol: index === 0 ? 'X' : 'O',
                  players: result.game.players
                });
              }
            });

            console.log(`🎮 Rematch started: ${newGameId}`);

            // Alert Admin
            sendAdminAlert(`⭕❌ *TTT Rematch Started!*\n👥 ${game.players[0].username} vs ${game.players[1].username}\n💰 Stake: *$${game.stake.toFixed(2)}*`);
          } else {
            socket.emit('ttt_error', { message: 'Failed to create rematch game' });
          }
        }
      } catch (err) {
        console.error('Error in TTT rematch:', err);
        socket.emit('ttt_error', { message: 'Rematch failed' });
      }
    });
    // ========== END TIC-TAC-TOE REMATCH ==========
    // ========== END TTT MATCHMAKING ==========



    socket.on('disconnect', async () => {
      // Keep removing from matchmaking queue logic if it was there? Yes.
      // Assuming removeFromQueue is global
      if (typeof removeFromQueue === 'function') removeFromQueue(socket.id);

      if (socket.gameId) {
        const gameId = socket.gameId;
        const Game = require('./models/Game');
        const game = await Game.findOne({ gameId });
        if (game) {
          const player = game.players.find(p => p.socketId === socket.id);
          if (player && player.userId) {
            const userId = player.userId;
            const disconnectTimeout = setTimeout(async () => {
              pendingDisconnects.delete(userId);
              if (typeof clearAllTimersForGame === 'function') clearAllTimersForGame(gameId);
              const result = await gameEngine.handleDisconnect(gameId, socket.id);
              if (result) {
                io.to(gameId).emit('GAME_STATE_UPDATE', { state: result.state });
                if (result.isCurrentTurn) scheduleAutoTurn(gameId, AUTO_TURN_DELAYS.AI_ROLL);
              }
            }, 15000);
            pendingDisconnects.set(userId, { timeoutId: disconnectTimeout, gameId });
            return;
          }
        }
        if (typeof clearAllTimersForGame === 'function') clearAllTimersForGame(gameId);
        const result = await gameEngine.handleDisconnect(gameId, socket.id);
        if (result) {
          io.to(gameId).emit('GAME_STATE_UPDATE', { state: result.state });
          if (result.isCurrentTurn) scheduleAutoTurn(gameId, AUTO_TURN_DELAYS.AI_ROLL);
        }
      }
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`✅ Server running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(`🌐 Accessible on network: http://[YOUR_IP]:${PORT}`);
    console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 MongoDB: ${mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'}`);
  });

  // Handle server errors
  server.on('error', (err) => {
    console.error('❌ Server error:', err);
    if (err.code === 'EADDRINUSE') {
      console.error(`💡 Port ${PORT} is already in use`);
    }
  });

})();
