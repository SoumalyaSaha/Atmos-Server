const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { safeAICall, safeAIChat, getAIStatus } = require('./ai-manager');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// AUTH CONFIG (Google verification + our own signed tokens)
// ============================================
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const JWT_SECRET = process.env.JWT_SECRET;

if (!GOOGLE_CLIENT_ID) {
  console.error('FATAL: GOOGLE_CLIENT_ID environment variable is not set!');
  process.exit(1);
}
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set!');
  process.exit(1);
}

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Asks Google directly "is this sign-in token genuine, and who does it belong to?"
// Throws if the token is missing, expired, tampered with, or issued for a different app.
async function verifyGoogleToken(idToken) {
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_ID,
  });
  return ticket.getPayload(); // { sub, email, name, picture, ... } — all Google-verified
}

// ============================================
// MONGODB CONNECTION
// ============================================
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('FATAL: MONGODB_URI environment variable is not set!');
  process.exit(1);
}

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected successfully'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });

// ============================================
// MONGOOSE SCHEMAS
// ============================================
const CarbonFootprintSchema = new mongoose.Schema({
  mobility: { type: Number, default: 0 },
  homeEnergy: { type: Number, default: 0 },
  diet: { type: Number, default: 0 },
  shopping: { type: Number, default: 0 },
  waste: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  lastCalculated: { type: String, default: null }
}, { _id: false });

const CalculationSchema = new mongoose.Schema({
  timestamp: { type: String, required: true },
  activities: { type: mongoose.Schema.Types.Mixed, default: null },
  result: { type: mongoose.Schema.Types.Mixed, default: null }
}, { _id: false });

const CarbonHistorySchema = new mongoose.Schema({
  date: { type: String, required: true },
  netFootprint: { type: Number, required: true }
}, { _id: false });

const BadgeSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  icon: { type: String, required: true },
  description: { type: String, required: true },
  earned: { type: String, required: true }
}, { _id: false });

const ChallengeSchema = new mongoose.Schema({
  id: { type: String, required: true },
  title: { type: String, required: true },
  completedAt: { type: String, required: true },
  co2Reduction: { type: String, default: '0' }
}, { _id: false });

const ActiveChallengeSchema = new mongoose.Schema({
  id: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  category: { type: String, default: '' },
  difficulty: { type: String, default: '' },
  duration: { type: String, default: '' },
  ecoPoints: { type: Number, default: 0 },
  co2Reduction: { type: String, default: '0' },
  icon: { type: String, default: '' },
  startedAt: { type: String, required: true },
  totalDays: { type: Number, default: 7 },
  daysCompleted: { type: [String], default: [] },
  progress: { type: Number, default: 0 }
}, { _id: false });

const DashboardCacheSchema = new mongoose.Schema({
  generatedAt: { type: String, required: true },
  footprintAtGeneration: { type: Number, default: 0 },
  breakdown: { type: mongoose.Schema.Types.Mixed, default: null },
  ecoScore: { type: Number, default: 0 },
  recommendations: { type: [String], default: [] },
  weeklyTrend: { type: [Number], default: [] }
}, { _id: false });

const CachedChallengesSchema = new mongoose.Schema({
  generatedAt: { type: String, required: true },
  challenges: { type: [mongoose.Schema.Types.Mixed], required: true },
  expiresAt: { type: String, required: true }
}, { _id: false });

const UserSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  googleId: { type: String, default: null, index: true },
  name: { type: String, default: null },
  email: { type: String, default: null },
  avatar: { type: String, default: null },
  joinDate: { type: String, default: () => new Date().toISOString() },
  age: { type: Number, default: null },
  ageGroup: { type: String, default: null },
  carbonFootprint: { type: CarbonFootprintSchema, default: () => ({}) },
  manualData: { type: mongoose.Schema.Types.Mixed, default: null },
  onboardingComplete: { type: Boolean, default: false },
  dataSource: { type: String, default: null },
  carbonHistory: { type: [CarbonHistorySchema], default: [] },
  totalCo2Saved: { type: Number, default: 0 },
  totalEcoPoints: { type: Number, default: 0 },
  streak: { type: Number, default: 0 },
  lastLoginDate: { type: String, default: null },
  loginHistory: { type: [String], default: [] },
  badges: { type: [BadgeSchema], default: [] },
  challengesCompleted: { type: [ChallengeSchema], default: [] },
  activeChallenges: { type: [ActiveChallengeSchema], default: [] },
  weeklyProgress: { type: [Number], default: [0, 0, 0, 0, 0, 0, 0] },
  lastWeekReset: { type: String, default: null },
  lastActivity: { type: String, default: () => new Date().toISOString() },
  insights: { type: mongoose.Schema.Types.Mixed, default: null },
  calculations: { type: [CalculationSchema], default: [] },
  personalBaseline: { type: Number, default: null },
  lastSavingsFootprint: { type: Number, default: null },
  lastSavingsTimestamp: { type: Number, default: null },
  dashboardCache: { type: DashboardCacheSchema, default: null },
  cachedChallenges: { type: CachedChallengesSchema, default: null }
}, { timestamps: true });

const User = mongoose.model('User', UserSchema);

// ============================================
// INDIA EMISSION FACTORS
// ============================================
const EMISSION_FACTORS = {
  transport: {
    'car_petrol': 0.21, 'car_diesel': 0.17, 'car_cng': 0.16,
    'bike_scooter': 0.10, 'bus': 0.089, 'metro_train': 0.041,
    'auto_rickshaw': 0.12, 'walking_cycling': 0
  },
  homeEnergy: {
    electricity: 0.71, lpg: 2.98, naturalGas: 2.1, biogas: 0.05
  },
  diet: {
    vegan: 1.5, vegetarian: 2.0, eggetarian: 2.3,
    meat_occasional: 2.8, meat_regular: 3.3, meat_heavy: 4.5
  },
  shopping: {
    clothing: 0.015, electronics: 0.05, furniture: 0.03,
    groceries: 0.008, other: 0.02
  },
  waste: {
    landfill: 0.5, recycled: 0.05, composted: 0.02
  }
};

const VEHICLE_TYPE_MAP = {
  'car_petrol': 'car_petrol', 'car_diesel': 'car_diesel', 'car_cng': 'car_cng',
  'bike_scooter': 'bike_scooter', 'bus': 'bus', 'metro_train': 'metro_train',
  'auto_rickshaw': 'auto_rickshaw', 'walking_cycling': 'walking_cycling',
  'bike_petrol': 'bike_scooter', 'bike': 'bike_scooter', 'scooter': 'bike_scooter',
  'metro': 'metro_train', 'train': 'metro_train',
  'walking': 'walking_cycling', 'cycling': 'walking_cycling',
  'walk': 'walking_cycling', 'cycle': 'walking_cycling'
};

function normalizeVehicleType(appVehicleType) {
  if (!appVehicleType) return null;
  const normalized = VEHICLE_TYPE_MAP[appVehicleType];
  if (!normalized) {
    console.warn(`[WARN] Unknown vehicle type "${appVehicleType}". Falling back to walking_cycling.`);
    return 'walking_cycling';
  }
  return normalized;
}

// ============================================
// GAMIFICATION CONFIG
// ============================================
const GAMIFICATION = {
  pointsPerKgSaved: 10, pointsPerChallenge: 100, pointsPerStreakDay: 5, pointsPerLogin: 2,
  levelThresholds: [0, 100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500],
  badges: [
    { id: 'first_step', name: 'First Step', icon: '🌱', desc: 'Complete your first carbon calculation', condition: (u) => u.calculations?.length >= 1 },
    { id: 'savings_star', name: 'Savings Star', icon: '⭐', desc: 'Save 50kg CO₂ total', condition: (u) => u.totalCo2Saved >= 50 },
    { id: 'eco_warrior', name: 'Eco Warrior', icon: '🛡️', desc: 'Save 200kg CO₂ total', condition: (u) => u.totalCo2Saved >= 200 },
    { id: 'streak_3', name: '3-Day Streak', icon: '🔥', desc: 'Login for 3 consecutive days', condition: (u) => u.streak >= 3 },
    { id: 'streak_7', name: '7-Day Streak', icon: '🔥🔥', desc: 'Login for 7 consecutive days', condition: (u) => u.streak >= 7 },
    { id: 'streak_30', name: 'Monthly Master', icon: '📅', desc: 'Login for 30 consecutive days', condition: (u) => u.streak >= 30 },
    { id: 'challenge_1', name: 'Challenge Accepted', icon: '🎯', desc: 'Complete your first challenge', condition: (u) => u.challengesCompleted?.length >= 1 },
    { id: 'challenge_5', name: 'Challenge Champion', icon: '🏆', desc: 'Complete 5 challenges', condition: (u) => u.challengesCompleted?.length >= 5 },
    { id: 'challenge_10', name: 'Eco Legend', icon: '👑', desc: 'Complete 10 challenges', condition: (u) => u.challengesCompleted?.length >= 10 },
    { id: 'zero_plastic', name: 'Plastic Free', icon: '🥤', desc: 'Complete Zero Plastic Week', condition: (u) => u.challengesCompleted?.some(c => c.id === 'zero_plastic') },
    { id: 'green_commuter', name: 'Green Commuter', icon: '🚲', desc: 'Complete Green Commuter challenge', condition: (u) => u.challengesCompleted?.some(c => c.id === 'green_commuter') },
    { id: 'meatless_master', name: 'Meatless Master', icon: '🥗', desc: 'Complete Meatless Mondays', condition: (u) => u.challengesCompleted?.some(c => c.id === 'meatless_mondays') }
  ]
};

// ============================================
// DATA HELPERS
// ============================================
async function getUserData(userId) {
  if (!userId) userId = 'default';
  let user = await User.findOne({ userId });
  if (!user) {
    user = new User({ userId });
    await user.save();
  }
  return user;
}

async function updateUserData(userId, updates) {
  if (!userId) userId = 'default';
  updates.lastActivity = new Date().toISOString();
  const user = await User.findOneAndUpdate(
    { userId },
    { $set: updates },
    { new: true, upsert: true }
  );
  return user;
}

// ============================================
// INPUT VALIDATION HELPERS
// ============================================
function validateManualData(data) {
  const errors = [];
  if (!data || typeof data !== 'object') return ['Manual data must be an object'];

  if (data.transport) {
    const { vehicleType, kmPerDay } = data.transport;
    const validVehicles = Object.keys(VEHICLE_TYPE_MAP);
    if (vehicleType && !validVehicles.includes(vehicleType)) {
      errors.push(`Invalid vehicle type: ${vehicleType}`);
    }
    if (kmPerDay !== undefined && (typeof kmPerDay !== 'number' || kmPerDay < 0 || kmPerDay > 10000)) {
      errors.push('kmPerDay must be a number between 0 and 10000');
    }
  }

  if (data.homeEnergy) {
    const { electricityKwh, gasUsage, householdSize } = data.homeEnergy;
    if (electricityKwh !== undefined && (typeof electricityKwh !== 'number' || electricityKwh < 0)) {
      errors.push('electricityKwh must be a non-negative number');
    }
    if (gasUsage !== undefined && (typeof gasUsage !== 'number' || gasUsage < 0)) {
      errors.push('gasUsage must be a non-negative number');
    }
    if (householdSize !== undefined && (!Number.isInteger(householdSize) || householdSize < 1 || householdSize > 50)) {
      errors.push('householdSize must be an integer between 1 and 50');
    }
  }

  if (data.diet) {
    const { dietType } = data.diet;
    const validDiets = Object.keys(EMISSION_FACTORS.diet);
    if (dietType && !validDiets.includes(dietType)) {
      errors.push(`Invalid diet type: ${dietType}`);
    }
  }

  if (data.shopping) {
    const { monthlySpend, category } = data.shopping;
    if (monthlySpend !== undefined && (typeof monthlySpend !== 'number' || monthlySpend < 0)) {
      errors.push('monthlySpend must be a non-negative number');
    }
    const validCategories = Object.keys(EMISSION_FACTORS.shopping);
    if (category && !validCategories.includes(category)) {
      errors.push(`Invalid shopping category: ${category}`);
    }
  }

  if (data.waste) {
    const { bagsPerWeek, householdSize, disposalMethod } = data.waste;
    if (bagsPerWeek !== undefined && (typeof bagsPerWeek !== 'number' || bagsPerWeek < 0)) {
      errors.push('bagsPerWeek must be a non-negative number');
    }
    if (householdSize !== undefined && (!Number.isInteger(householdSize) || householdSize < 1)) {
      errors.push('waste.householdSize must be a positive integer');
    }
    const validMethods = Object.keys(EMISSION_FACTORS.waste);
    if (disposalMethod && !validMethods.includes(disposalMethod)) {
      errors.push(`Invalid disposal method: ${disposalMethod}`);
    }
  }

  return errors;
}

function validateChallengeCompletion(body) {
  const errors = [];
  if (!body.challengeId || typeof body.challengeId !== 'string') {
    errors.push('challengeId is required and must be a string');
  }
  if (body.co2Reduction !== undefined && (typeof body.co2Reduction !== 'number' || body.co2Reduction < 0)) {
    errors.push('co2Reduction must be a non-negative number');
  }
  return errors;
}

// ============================================
// GAMIFICATION ENGINE
// ============================================
async function recordLogin(userId) {
  const userData = await getUserData(userId);
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  let newStreak = userData.streak || 0;
  let loginHistory = [...(userData.loginHistory || [])];

  if (!loginHistory.includes(today)) {
    loginHistory.push(today);
    if (userData.lastLoginDate === yesterdayStr) {
      newStreak += 1;
    } else if (userData.lastLoginDate !== today) {
      newStreak = 1;
    }
  }

  let weeklyProgress = [...(userData.weeklyProgress || [0, 0, 0, 0, 0, 0, 0])];
  let lastWeekReset = userData.lastWeekReset;
  const currentWeekStart = getWeekStart(new Date());

  if (lastWeekReset !== currentWeekStart) {
    weeklyProgress = [0, 0, 0, 0, 0, 0, 0];
    lastWeekReset = currentWeekStart;
  }

  let ecoPoints = userData.totalEcoPoints || 0;
  if (!userData.loginHistory?.includes(today)) {
    ecoPoints += GAMIFICATION.pointsPerLogin;
  }

  const updates = {
    lastLoginDate: today,
    loginHistory: loginHistory.slice(-90),
    streak: newStreak,
    totalEcoPoints: Math.round(ecoPoints),
    weeklyProgress,
    lastWeekReset
  };

  return await updateUserData(userId, updates);
}

function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().split('T')[0];
}

async function addChallengeProgress(userId, challengeId, challengeTitle, co2Reduction) {
  const userData = await getUserData(userId);
  const today = new Date().toISOString().split('T')[0];
  const dayIndex = new Date().getDay();

  if (userData.challengesCompleted?.some(c => c.id === challengeId)) {
    return userData;
  }

  const newChallenge = {
    id: challengeId,
    title: challengeTitle,
    completedAt: new Date().toISOString(),
    co2Reduction: Math.max(0, co2Reduction || 0)
  };

  const challengesCompleted = [...(userData.challengesCompleted || []), newChallenge];
  const weeklyProgress = [...(userData.weeklyProgress || [0, 0, 0, 0, 0, 0, 0])];
  weeklyProgress[dayIndex] = (weeklyProgress[dayIndex] || 0) + 1;

  const ecoPoints = (userData.totalEcoPoints || 0) + GAMIFICATION.pointsPerChallenge;
  const co2Saved = (userData.totalCo2Saved || 0) + (co2Reduction || 0);

  return await updateUserData(userId, {
    challengesCompleted,
    weeklyProgress,
    totalEcoPoints: Math.round(ecoPoints),
    totalCo2Saved: Math.round(co2Saved * 100) / 100
  });
}

// ============================================
// CARBON SAVINGS LOGIC
// ============================================
async function calculateCarbonSavings(userId, newFootprint) {
  const userData = await getUserData(userId);

  let baseline = userData.personalBaseline;
  if (!baseline) {
    baseline = newFootprint;
    await updateUserData(userId, { personalBaseline: baseline });
  }

  const previousSaved = userData.totalCo2Saved || 0;
  const currentSaved = Math.max(0, baseline - newFootprint);
  const additionalSaved = Math.max(0, currentSaved - previousSaved);

  const now = Date.now();
  const lastTimestamp = userData.lastSavingsTimestamp || 0;
  const lastFootprint = userData.lastSavingsFootprint;

  if (lastFootprint === newFootprint && (now - lastTimestamp) < 5000) {
    return userData;
  }

  const newTotalSaved = previousSaved + additionalSaved;
  const ecoPoints = (userData.totalEcoPoints || 0) + (additionalSaved * GAMIFICATION.pointsPerKgSaved);

  return await updateUserData(userId, {
    totalCo2Saved: Math.round(newTotalSaved * 100) / 100,
    totalEcoPoints: Math.round(ecoPoints),
    lastSavingsFootprint: newFootprint,
    lastSavingsTimestamp: now
  });
}

async function checkAndAwardBadges(userId) {
  const userData = await getUserData(userId);
  const currentBadges = userData.badges || [];
  const newBadges = [];

  for (const badge of GAMIFICATION.badges) {
    if (!currentBadges.some(b => b.id === badge.id)) {
      if (badge.condition(userData)) {
        newBadges.push({
          id: badge.id,
          name: badge.name,
          icon: badge.icon,
          description: badge.desc,
          earned: new Date().toISOString()
        });
      }
    }
  }

  if (newBadges.length > 0) {
    const allBadges = [...currentBadges, ...newBadges];
    await updateUserData(userId, { badges: allBadges });
  }

  return newBadges;
}

// ============================================
// LEVEL INFO
// ============================================
function getLevelInfo(ecoPoints) {
  const points = Math.round(ecoPoints);
  const thresholds = GAMIFICATION.levelThresholds;
  let level = 1;
  let nextLevelPoints = thresholds[1];

  for (let i = 0; i < thresholds.length; i++) {
    if (points >= thresholds[i]) {
      level = i + 1;
      nextLevelPoints = thresholds[i + 1] || thresholds[i] + 1000;
    } else {
      break;
    }
  }

  const currentLevelPoints = thresholds[level - 1] || 0;
  const pointsToNext = nextLevelPoints - currentLevelPoints;
  const currentProgress = points - currentLevelPoints;
  const percentage = Math.min(100, Math.round((currentProgress / pointsToNext) * 100));

  return {
    currentLevel: level,
    nextLevel: level + 1,
    currentPoints: currentProgress,
    pointsToNext: pointsToNext,
    percentage: percentage,
    totalPoints: points
  };
}

function generateRecentActivity(userData) {
  const activities = [];

  if (userData.streak > 0) {
    activities.push({
      icon: 'Calendar',
      title: `${userData.streak}-Day Streak`,
      desc: `Logged in for ${userData.streak} consecutive days`,
      time: userData.lastLoginDate,
      color: 'text-atmos-400'
    });
  }

  const challenges = (userData.challengesCompleted || []).slice(-3);
  challenges.forEach(c => {
    activities.push({
      icon: 'Award',
      title: `Completed ${c.title}`,
      desc: `Saved ${c.co2Reduction}kg CO₂`,
      time: c.completedAt,
      color: 'text-amber-400'
    });
  });

  const badges = (userData.badges || []).slice(-3);
  badges.forEach(b => {
    activities.push({
      icon: 'Shield',
      title: `Earned ${b.name}`,
      desc: b.description,
      time: b.earned,
      color: 'text-green-400'
    });
  });

  const calculations = (userData.calculations || []).slice(-2);
  calculations.forEach(c => {
    activities.push({
      icon: 'TrendingUp',
      title: 'Updated Carbon Footprint',
      desc: `New total: ${c.result?.netFootprint || c.result?.total || 0}kg CO₂`,
      time: c.timestamp,
      color: 'text-ocean-400'
    });
  });

  return activities
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, 6)
    .map(a => ({
      ...a,
      time: formatRelativeTime(a.time)
    }));
}

function formatRelativeTime(isoDate) {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return `${Math.floor(diffDays / 30)} months ago`;
}

// ============================================
// CARBON CALCULATION ENGINE
// ============================================
function calculateCarbonFootprint(manualData) {
  const result = {
    mobility: 0.00, homeEnergy: 0.00, diet: 0.00,
    shopping: 0.00, waste: 0.00, total: 0.00,
    lastCalculated: new Date().toISOString()
  };

  if (!manualData) return result;

  if (manualData.transport) {
    let { vehicleType, kmPerDay } = manualData.transport;
    const normalizedType = normalizeVehicleType(vehicleType);
    const factor = EMISSION_FACTORS.transport[normalizedType] || 0;
    result.mobility = parseFloat((kmPerDay * 30 * factor).toFixed(2));
  }

  if (manualData.homeEnergy) {
    const { electricityKwh, gasUsage, gasType, householdSize } = manualData.homeEnergy;
    const elec = (electricityKwh || 0) * EMISSION_FACTORS.homeEnergy.electricity;
    const gas = (gasUsage || 0) * (EMISSION_FACTORS.homeEnergy[gasType] || EMISSION_FACTORS.homeEnergy.lpg);
    result.homeEnergy = parseFloat(((elec + gas) / (householdSize || 1)).toFixed(2));
  }

  if (manualData.diet) {
    const { dietType } = manualData.diet;
    const daily = EMISSION_FACTORS.diet[dietType] || EMISSION_FACTORS.diet.vegetarian;
    result.diet = parseFloat((daily * 30).toFixed(2));
  }

  if (manualData.shopping) {
    const { monthlySpend, category } = manualData.shopping;
    const factor = EMISSION_FACTORS.shopping[category] || EMISSION_FACTORS.shopping.other;
    result.shopping = parseFloat((monthlySpend * factor).toFixed(2));
  }

  if (manualData.waste) {
    const { bagsPerWeek, householdSize, disposalMethod } = manualData.waste;
    const monthlyKg = (bagsPerWeek || 0) * 5 * 4;
    const factor = EMISSION_FACTORS.waste[disposalMethod] || EMISSION_FACTORS.waste.landfill;
    result.waste = parseFloat(((monthlyKg / (householdSize || 1)) * factor).toFixed(2));
  }

  result.total = parseFloat((
    result.mobility + result.homeEnergy + result.diet +
    result.shopping + result.waste
  ).toFixed(2));

  return result;
}

// ============================================
// MIDDLEWARE
// ============================================
const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL,
  'http://localhost:5173', // local dev
].filter(Boolean);

app.use(cors({
  origin: ALLOWED_ORIGINS,
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ============================================
// AUTH MIDDLEWARE — verifies OUR signed token, not a self-reported header
// ============================================
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, error: 'NO_TOKEN', message: 'Please sign in.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId; // trusted — came from a signature only our server could create
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'INVALID_TOKEN', message: 'Session expired, please sign in again.' });
  }
}

// Kept for the routes below that were written to call extractUserId(req) —
// now it just reads the value the middleware already verified, never a raw header.
function extractUserId(req) {
  return req.userId;
}

// ============================================
// HEALTH CHECK
// ============================================
app.get('/', (req, res) => {
  res.json({
    status: 'Atmos AI Backend is running',
    version: '3.2.0-fixed',
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    ai: getAIStatus(),
    features: ['manual_entry', 'real_calculations', 'ai_insights', 'gamification', 'mongodb_persistence']
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    ai: getAIStatus(),
  });
});

// ============================================
// AUTH & LOGIN - FULLY FIXED
// ============================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_CREDENTIAL',
        message: 'Google credential is required'
      });
    }

    // Ask Google to confirm this token is real — this is the check that was missing before.
    let payload;
    try {
      payload = await verifyGoogleToken(credential);
    } catch (verifyErr) {
      console.warn('[LOGIN] Google token verification failed:', verifyErr.message);
      return res.status(401).json({
        success: false,
        error: 'INVALID_GOOGLE_TOKEN',
        message: 'Could not verify Google sign-in. Please try again.'
      });
    }

    // Everything below now uses ONLY the Google-verified payload — never anything
    // the client claimed about itself.
    const googleId = payload.sub;
    const name = payload.name;
    const email = payload.email;
    const avatar = payload.picture;
    const picture = payload.picture;

    console.log(`[LOGIN] Attempt with googleId: ${googleId}`);
    
    // Look up by googleId first
    let existingUser = await User.findOne({ googleId });
    console.log(`[LOGIN] existingUser found: ${!!existingUser}`);
    
    let userData;
    let isNewUser = false;
    let userId;
    
    if (existingUser) {
      // === EXISTING USER ===
      userId = existingUser.userId;
      console.log(`[LOGIN] Existing user. userId: ${userId}`);
      
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      
      let newStreak = existingUser.streak || 0;
      let loginHistory = [...(existingUser.loginHistory || [])];
      
      if (!loginHistory.includes(today)) {
        loginHistory.push(today);
        if (existingUser.lastLoginDate === yesterdayStr) {
          newStreak += 1;
        } else if (existingUser.lastLoginDate !== today) {
          newStreak = 1;
        }
      }
      
      let weeklyProgress = [...(existingUser.weeklyProgress || [0,0,0,0,0,0,0])];
      let lastWeekReset = existingUser.lastWeekReset;
      const currentWeekStart = getWeekStart(new Date());
      
      if (lastWeekReset !== currentWeekStart) {
        weeklyProgress = [0,0,0,0,0,0,0];
        lastWeekReset = currentWeekStart;
      }
      
      let ecoPoints = existingUser.totalEcoPoints || 0;
      if (!existingUser.loginHistory?.includes(today)) {
        ecoPoints += 2;
      }
      
      const updates = {
        lastLoginDate: today,
        loginHistory: loginHistory.slice(-90),
        streak: newStreak,
        totalEcoPoints: Math.round(ecoPoints),
        weeklyProgress,
        lastWeekReset,
        lastActivity: new Date().toISOString()
      };
      
      if (name && name !== existingUser.name) updates.name = name;
      if (email && email !== existingUser.email) updates.email = email;
      if ((avatar || picture) && (avatar !== existingUser.avatar && picture !== existingUser.avatar)) {
        updates.avatar = avatar || picture;
      }
      
      userData = await User.findOneAndUpdate(
        { userId: userId },
        { $set: updates },
        { new: true }
      );
      
    } else {
      // === NEW USER ===
      userId = 'usr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      isNewUser = true;
      console.log(`[LOGIN] New user created. userId: ${userId}`);
      
      const today = new Date().toISOString().split('T')[0];
      
      const newUser = new User({
        userId: userId,
        googleId: googleId,
        name: name || null,
        email: email || null,
        avatar: avatar || picture || null,
        joinDate: new Date().toISOString(),
        age: null,
        ageGroup: null,
        onboardingComplete: false,
        totalEcoPoints: 2, // First login bonus
        totalCo2Saved: 0,
        streak: 1,
        badges: [],
        challengesCompleted: [],
        activeChallenges: [],
        carbonHistory: [],
        weeklyProgress: [0,0,0,0,0,0,0],
        lastWeekReset: getWeekStart(new Date()),
        lastLoginDate: today,
        loginHistory: [today],
        lastActivity: new Date().toISOString()
      });
      
      await newUser.save();
      userData = newUser;
    }

    // Check and award badges
    const currentBadges = userData.badges || [];
    const newBadges = [];
    
    for (const badge of GAMIFICATION.badges) {
      if (!currentBadges.some(b => b.id === badge.id)) {
        if (badge.condition(userData)) {
          newBadges.push({
            id: badge.id,
            name: badge.name,
            icon: badge.icon,
            description: badge.desc,
            earned: new Date().toISOString()
          });
        }
      }
    }
    
    if (newBadges.length > 0) {
      const allBadges = [...currentBadges, ...newBadges];
      await User.findOneAndUpdate(
        { userId: userData.userId },
        { $set: { badges: allBadges } }
      );
      userData.badges = allBadges;
    }

    console.log(`[LOGIN] Success. userId: ${userData.userId}, isNewUser: ${isNewUser}, onboardingComplete: ${userData.onboardingComplete}`);

    // Our own signed "key card" — the app will send this back on every future
    // request instead of a plain, editable userId tag.
    const token = jwt.sign(
      { userId: userData.userId, googleId: userData.googleId },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      isNewUser: isNewUser,
      token: token,
      user: {
        userId: userData.userId,
        googleId: userData.googleId,
        name: userData.name,
        email: userData.email,
        avatar: userData.avatar,
        picture: userData.avatar,
        age: userData.age,
        ageGroup: userData.ageGroup,
        onboardingComplete: userData.onboardingComplete,
        carbonFootprint: userData.carbonFootprint,
        manualData: userData.manualData,
        streak: userData.streak,
        ecoPoints: userData.totalEcoPoints,
        totalEcoPoints: userData.totalEcoPoints,
        totalCo2Saved: userData.totalCo2Saved,
        badges: userData.badges,
        newBadges: newBadges,
        activeChallenges: userData.activeChallenges || [],
        challengesCompleted: userData.challengesCompleted || [],
        carbonHistory: userData.carbonHistory || [],
        dashboardCache: userData.dashboardCache || null,
        insights: userData.insights || null,
        joinDate: userData.joinDate
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'LOGIN_ERROR',
      message: error.message
    });
  }
});

// ============================================
// Everything below this line requires a valid, verified sign-in.
// (Health checks above and /api/auth/login above are the only public routes.)
// ============================================
app.use(authenticateToken);

// ============================================
// CARBON CALCULATION ROUTES
// ============================================
app.post('/api/carbon/manual', async (req, res) => {
  console.log('POST /api/carbon/manual hit');
  console.log('Body:', JSON.stringify(req.body, null, 2));

  const userId = extractUserId(req);
  const { manualData, name, email, avatar } = req.body;

  const validationErrors = validateManualData(manualData);
  if (validationErrors.length > 0) {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'Invalid input data',
      details: validationErrors
    });
  }

  if (!manualData) {
    return res.status(400).json({
      success: false,
      error: 'NO_DATA',
      message: 'Manual data is required.'
    });
  }

  try {
    const carbonFootprint = calculateCarbonFootprint(manualData);
    console.log('Calculated footprint:', carbonFootprint);

    await calculateCarbonSavings(userId, carbonFootprint.total);

    const identityUpdates = {};
    if (name) identityUpdates.name = name;
    if (email) identityUpdates.email = email;
    if (avatar) identityUpdates.avatar = avatar;

    const user = await getUserData(userId);
    const updated = await updateUserData(userId, {
      manualData,
      carbonFootprint,
      onboardingComplete: true,
      dataSource: 'manual',
      carbonHistory: [
        ...(user.carbonHistory || []),
        { date: new Date().toISOString(), netFootprint: carbonFootprint.total }
      ].slice(-30),
      ...identityUpdates
    });

    const newBadges = await checkAndAwardBadges(userId);

    res.json({
      success: true,
      carbonFootprint,
      manualData: updated.manualData,
      onboardingComplete: true,
      ecoPoints: updated.totalEcoPoints,
      co2Saved: updated.totalCo2Saved,
      newBadges: newBadges
    });
  } catch (error) {
    console.error('Calculation error:', error);
    res.status(500).json({
      success: false,
      error: 'CALCULATION_ERROR',
      message: error.message
    });
  }
});

app.get('/api/carbon/footprint', async (req, res) => {
  const userId = extractUserId(req);
  const userData = await getUserData(userId);

  res.json({
    success: true,
    carbonFootprint: userData.carbonFootprint,
    onboardingComplete: userData.onboardingComplete,
    dataSource: userData.dataSource
  });
});

app.patch('/api/carbon/footprint', async (req, res) => {
  const userId = extractUserId(req);
  const { sector, data } = req.body;
  const userData = await getUserData(userId);

  if (!sector || typeof sector !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'sector is required and must be a string'
    });
  }

  const validSectors = ['transport', 'homeEnergy', 'diet', 'shopping', 'waste'];
  if (!validSectors.includes(sector)) {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: `Invalid sector. Must be one of: ${validSectors.join(', ')}`
    });
  }

  if (!userData.manualData) {
    return res.status(400).json({
      success: false,
      error: 'NO_MANUAL_DATA',
      message: 'Complete onboarding first.'
    });
  }

  const partialData = { [sector]: data };
  const validationErrors = validateManualData(partialData);
  if (validationErrors.length > 0) {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'Invalid sector data',
      details: validationErrors
    });
  }

  const updatedManualData = { ...userData.manualData, [sector]: data };
  const carbonFootprint = calculateCarbonFootprint(updatedManualData);

  await calculateCarbonSavings(userId, carbonFootprint.total);

  const newCarbonHistory = [
    ...(userData.carbonHistory || []),
    { date: new Date().toISOString(), netFootprint: carbonFootprint.total }
  ].slice(-30);

  const weeklyTrend = newCarbonHistory.slice(-7).map(h => h.netFootprint);
  while (weeklyTrend.length < 7) weeklyTrend.unshift(0);

  const newDashboardCache = {
    generatedAt: new Date().toISOString(),
    footprintAtGeneration: carbonFootprint.total,
    breakdown: [
      { category: 'Mobility', emission: carbonFootprint.mobility, icon: '🚗' },
      { category: 'Home Energy', emission: carbonFootprint.homeEnergy, icon: '⚡' },
      { category: 'Diet', emission: carbonFootprint.diet, icon: '🥗' },
      { category: 'Shopping', emission: carbonFootprint.shopping, icon: '🛒' },
      { category: 'Waste', emission: carbonFootprint.waste, icon: '🗑️' }
    ],
    recommendations: ['Great job updating your carbon data! Keep tracking regularly for accurate insights.'],
    ecoScore: Math.max(0, Math.min(100, Math.round(100 - (carbonFootprint.total / 10)))),
    weeklyTrend: weeklyTrend
  };

  const updated = await updateUserData(userId, {
    manualData: updatedManualData,
    carbonFootprint,
    carbonHistory: newCarbonHistory,
    dashboardCache: newDashboardCache
  });

  const newBadges = await checkAndAwardBadges(userId);

  res.json({
    success: true,
    carbonFootprint,
    manualData: updated.manualData,
    ecoPoints: updated.totalEcoPoints,
    co2Saved: updated.totalCo2Saved,
    newBadges: newBadges,
    dashboardUpdated: true,
    source: 'local_calculation'
  });
});

app.get('/api/carbon/factors', (req, res) => {
  res.json({ success: true, factors: EMISSION_FACTORS });
});

// ============================================
// AI-POWERED CARBON CALCULATE
// ============================================
app.post('/api/carbon/calculate', async (req, res) => {
  const userId = extractUserId(req);
  const userData = await getUserData(userId);

  try {
    if (userData.dashboardCache && userData.dashboardCache.breakdown) {
      console.log(`[CACHE HIT] Dashboard for ${userId}`);
      return res.json({
        success: true,
        data: {
          totalEmissions: userData.carbonFootprint.total,
          totalOffset: 0,
          netFootprint: userData.carbonFootprint.total,
          breakdown: userData.dashboardCache.breakdown,
          recommendations: userData.dashboardCache.recommendations,
          ecoScore: userData.dashboardCache.ecoScore,
          weeklyTrend: userData.dashboardCache.weeklyTrend
        },
        persisted: true,
        source: 'mongodb_cache',
        cached: true
      });
    }

    if (userData.manualData && userData.carbonFootprint?.lastCalculated) {
      const manualBreakdown = [
        { category: 'Mobility', emission: userData.carbonFootprint.mobility, icon: '🚗' },
        { category: 'Home Energy', emission: userData.carbonFootprint.homeEnergy, icon: '⚡' },
        { category: 'Diet', emission: userData.carbonFootprint.diet, icon: '🥗' },
        { category: 'Shopping', emission: userData.carbonFootprint.shopping, icon: '🛒' },
        { category: 'Waste', emission: userData.carbonFootprint.waste, icon: '🗑️' }
      ];
      
      return res.json({
        success: true,
        data: {
          totalEmissions: userData.carbonFootprint.total,
          totalOffset: 0,
          netFootprint: userData.carbonFootprint.total,
          breakdown: manualBreakdown,
          recommendations: ['Update your data regularly for accurate tracking'],
          ecoScore: Math.max(0, Math.min(100, 100 - (userData.carbonFootprint.total / 10))),
          weeklyTrend: userData.carbonHistory.slice(-7).map(h => h.netFootprint)
        },
        persisted: true,
        source: 'manual_data'
      });
    }

    const { activities } = req.body;
    const prompt = 'You are Atmos AI, a carbon footprint expert. Analyze these user activities and calculate approximate carbon emissions/offset in kg CO2e. Return ONLY a JSON object with this exact structure (no markdown, no explanation): {"totalEmissions": number, "totalOffset": number, "netFootprint": number, "breakdown": [{"category": "string", "emission": number, "icon": "string"}], "recommendations": ["string"], "ecoScore": number, "weeklyTrend": [number, number, number, number, number, number, number]} Activities: ' + JSON.stringify(activities);

    const text = await safeAICall(prompt, userId);
    const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const data = JSON.parse(cleanJson);

    await updateUserData(userId, {
      dashboardCache: {
        generatedAt: new Date().toISOString(),
        footprintAtGeneration: data.netFootprint,
        breakdown: data.breakdown,
        ecoScore: data.ecoScore,
        recommendations: data.recommendations,
        weeklyTrend: data.weeklyTrend
      }
    });

    userData.calculations.push({ timestamp: new Date().toISOString(), activities, result: data });
    if (userData.calculations.length > 50) userData.calculations = userData.calculations.slice(-50);
    await updateUserData(userId, {
      calculations: userData.calculations,
      carbonHistory: [...userData.carbonHistory, { date: new Date().toISOString(), netFootprint: data.netFootprint }].slice(-30)
    });

    res.json({ success: true, data, persisted: true, source: 'ai_generated' });
  } catch (error) {
    console.error('Carbon calculation error:', error);
    if (error.message === 'ALL_AI_KEYS_EXHAUSTED') {
      const lastCalc = userData.calculations[userData.calculations.length - 1];
      return res.status(429).json({
        success: false,
        error: 'DAILY_LIMIT_EXHAUSTED',
        message: 'You have used the daily limit of Atmos AI. Please wait for the next day for reset.',
        resetTime: new Date(new Date().setHours(24, 0, 0, 0)).toISOString(),
        preservedData: {
          lastCalculation: lastCalc || null,
          totalCo2Saved: userData.totalCo2Saved,
          totalEcoPoints: userData.totalEcoPoints,
          streak: userData.streak,
          badges: userData.badges,
          carbonHistory: userData.carbonHistory
        }
      });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// AI INSIGHTS
// ============================================
app.get('/api/ai/insights', async (req, res) => {
  const userId = extractUserId(req);
  
  try {
    const userData = await getUserData(userId);
    
    if (userData.insights && userData.insights.summary) {
      console.log(`[CACHE HIT] Returning cached insights for ${userId}`);
      return res.json({
        success: true,
        data: userData.insights,
        cached: true,
        source: 'mongodb'
      });
    }
    
    res.status(404).json({
      success: false,
      cached: false,
      message: 'No cached insights found. Call POST /api/ai/insights to generate.'
    });
    
  } catch (error) {
    console.error('Get insights error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/ai/insights', async (req, res) => {
  const userId = extractUserId(req);
  
  try {
    const userData = await getUserData(userId);
    const { forceRefresh } = req.body;
    
    const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
    const insightsAge = userData.insights?.generatedAt 
      ? Date.now() - new Date(userData.insights.generatedAt).getTime() 
      : Infinity;
    
    const currentFootprint = userData.carbonFootprint?.total || 0;
    const oldFootprint = userData.insights?.footprintAtGeneration || 0;
    const footprintChange = Math.abs(currentFootprint - oldFootprint);
    
    if (!forceRefresh && userData.insights && userData.insights.summary && 
        insightsAge < ONE_WEEK && footprintChange < 10) {
      console.log(`[CACHE HIT] Returning cached insights for ${userId}`);
      return res.json({
        success: true,
        data: userData.insights,
        cached: true,
        source: 'mongodb',
        message: 'Using cached insights'
      });
    }
    
    console.log(`[CACHE MISS] Generating new insights for ${userId}`);

    const { userData: inputData, period } = req.body;
    const prompt = 'You are Atmos AI, an expert sustainability advisor. Based on this user activity data, provide personalized carbon footprint insights. Return ONLY a JSON object: {"summary": "string", "keyInsights": ["string"], "actionItems": [{"title": "string", "impact": "string", "difficulty": "Easy|Medium|Hard", "co2Saved": "string"}], "trendAnalysis": "string", "goalProgress": {"current": number, "target": number, "unit": "kg CO2e"}} User Data: ' + JSON.stringify(inputData) + ' Historical Carbon Data: ' + JSON.stringify(userData.carbonHistory.slice(-7));

    const text = await safeAICall(prompt, userId);
    const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const data = JSON.parse(cleanJson);
    
    data.generatedAt = new Date().toISOString();
    data.footprintAtGeneration = userData.carbonFootprint?.total || 0;
    
    await updateUserData(userId, { insights: data });
    res.json({ success: true, data, persisted: true, source: 'ai_generated' });
  } catch (error) {
    console.error('AI insights error:', error);
    if (error.message === 'ALL_AI_KEYS_EXHAUSTED') {
      const userData = await getUserData(userId);
      return res.status(429).json({
        success: false,
        error: 'DAILY_LIMIT_EXHAUSTED',
        message: 'You have used the daily limit of Atmos AI. Please wait for the next day for reset.',
        resetTime: new Date(new Date().setHours(24, 0, 0, 0)).toISOString(),
        preservedData: {
          lastInsights: userData.insights,
          totalCo2Saved: userData.totalCo2Saved,
          totalEcoPoints: userData.totalEcoPoints,
          streak: userData.streak,
          badges: userData.badges,
          carbonHistory: userData.carbonHistory
        }
      });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// AI CHATBOT
// ============================================
const FAQ_CACHE = {
  'what is carbon footprint': 'A carbon footprint is the total amount of greenhouse gases (including CO₂ and methane) generated by our actions. The average person produces about 4-16 tons per year.',
  'how to reduce carbon footprint': 'Top ways: use public transport, eat less meat, reduce electricity use, buy local products, minimize waste, and choose renewable energy when possible.',
  'what is atmos': 'Atmos is your personal AI-powered carbon footprint tracker. It helps you measure, understand, and reduce your environmental impact through smart insights and gamified challenges.',
  'how to earn eco points': 'Earn points by: logging in daily (+2), completing challenges (+100), maintaining login streaks (+5/day), and reducing your carbon footprint (+10 per kg saved).',
  'what are challenges': 'Challenges are sustainability goals like "Zero Plastic Week" or "Green Commuter." Complete them to earn eco points, save CO₂, and unlock badges.',
  'how to level up': 'Level up by earning eco points! You need 100 points for Level 2, 300 for Level 3, and so on. Complete challenges and reduce emissions to gain points faster.',
  'what is my score': 'Your eco score (0-100) reflects how sustainable your lifestyle is. Higher is better! Update your carbon data regularly to see your score improve.',
  'how does atmos work': 'Atmos tracks your daily activities, calculates your carbon footprint using India-specific emission factors, gives AI-powered insights, and gamifies your journey with challenges and badges.'
};

app.post('/api/ai/chat', async (req, res) => {
  const userId = extractUserId(req);
  
  try {
    const { message, chatHistory } = req.body;

    const lowerMsg = message.toLowerCase().trim();
    for (const [question, answer] of Object.entries(FAQ_CACHE)) {
      if (lowerMsg.includes(question) || question.includes(lowerMsg)) {
        return res.json({
          success: true,
          reply: answer,
          cached: true,
          source: 'faq'
        });
      }
    }

    const history = (chatHistory || []).map(msg => ({
      role: msg.role === 'model' ? 'assistant' : msg.role,
      content: msg.content || (msg.parts && msg.parts[0] && msg.parts[0].text) || ''
    }));

    const reply = await safeAIChat(message, history, userId);

    res.json({
      success: true,
      reply: reply,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Chat error:', error);
    if (error.message === 'ALL_AI_KEYS_EXHAUSTED' || error.message === 'GLOBAL_RATE_LIMIT_EXCEEDED' || error.message === 'USER_RATE_LIMIT_EXCEEDED') {
      const userData = await getUserData(userId);
      return res.status(429).json({
        success: false,
        error: 'DAILY_LIMIT_EXHAUSTED',
        message: 'You have used the daily limit of Atmos AI. Please wait for the next day for reset.',
        resetTime: new Date(new Date().setHours(24, 0, 0, 0)).toISOString(),
        preservedData: {
          totalCo2Saved: userData.totalCo2Saved,
          totalEcoPoints: userData.totalEcoPoints,
          streak: userData.streak,
          badges: userData.badges,
          carbonHistory: userData.carbonHistory
        }
      });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// CHALLENGES
// ============================================
const HACKATHON_CHALLENGES = [
  { id: 'zero_plastic', title: 'Zero Plastic Week', description: 'Avoid all single-use plastics for 7 days', category: 'Waste', difficulty: 'Medium', duration: '7 days', ecoPoints: 500, co2Reduction: '2.5', participants: 1247, icon: '🥤' },
  { id: 'green_commuter', title: 'Green Commuter', description: 'Use only public transport for 14 days', category: 'Transport', difficulty: 'Hard', duration: '14 days', ecoPoints: 800, co2Reduction: '8.2', participants: 892, icon: '🚲' },
  { id: 'meatless_mondays', title: 'Meatless Mondays', description: 'Go vegetarian every Monday', category: 'Food', difficulty: 'Easy', duration: '30 days', ecoPoints: 300, co2Reduction: '4.1', participants: 2156, icon: '🥗' },
  { id: 'energy_saver', title: 'Energy Saver', description: 'Reduce electricity by 20% for 2 weeks', category: 'Energy', difficulty: 'Medium', duration: '14 days', ecoPoints: 600, co2Reduction: '5.0', participants: 1567, icon: '⚡' },
  { id: 'water_warrior', title: 'Water Warrior', description: 'Reduce water usage by 30%', category: 'Water', difficulty: 'Easy', duration: '7 days', ecoPoints: 400, co2Reduction: '1.5', participants: 2103, icon: '💧' },
  { id: 'shop_local', title: 'Shop Local', description: 'Buy only local products for a month', category: 'Shopping', difficulty: 'Hard', duration: '30 days', ecoPoints: 700, co2Reduction: '3.2', participants: 987, icon: '🛒' }
];

app.get('/api/challenges', async (req, res) => {
  const userId = extractUserId(req);
  const userData = await getUserData(userId);
  
  const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  
  if (userData.cachedChallenges && userData.cachedChallenges.challenges) {
    const cacheAge = now - new Date(userData.cachedChallenges.generatedAt).getTime();
    
    if (cacheAge < THREE_DAYS) {
      console.log(`[CACHE HIT] Challenges for ${userId}, age: ${Math.round(cacheAge / 3600000)}h`);
      return res.json({
        success: true,
        challenges: userData.cachedChallenges.challenges,
        cached: true,
        source: 'mongodb',
        nextRefreshIn: Math.round((THREE_DAYS - cacheAge) / 3600000) + ' hours'
      });
    }
  }
  
  console.log(`[CACHE MISS] Generating challenges for ${userId}`);
  
  try {
    const prompt = 'Generate 6 sustainability challenges for a carbon footprint app. Return ONLY a JSON array: [{"id": "string", "title": "string", "description": "string", "category": "Transport|Energy|Food|Waste|Water|Shopping", "difficulty": "Easy|Medium|Hard", "duration": "string", "ecoPoints": number, "co2Reduction": "string", "participants": number, "icon": "string"}]';
    
    const text = await safeAICall(prompt);
    const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const newChallenges = JSON.parse(cleanJson);
    
    const mergedChallenges = newChallenges.map((newChal, index) => {
      const matchingActive = userData.activeChallenges?.find(a => 
        a.title === newChal.title || a.id === newChal.id
      );
      if (matchingActive) {
        return { ...newChal, id: matchingActive.id };
      }
      return { ...newChal, id: `chal_${Date.now()}_${index}` };
    });
    
    await updateUserData(userId, {
      cachedChallenges: {
        generatedAt: new Date().toISOString(),
        challenges: mergedChallenges,
        expiresAt: new Date(now + THREE_DAYS).toISOString()
      }
    });
    
    res.json({
      success: true,
      challenges: mergedChallenges,
      cached: false,
      source: 'ai_generated'
    });
    
  } catch (error) {
    console.error('Challenges error:', error);
    
    if (userData.cachedChallenges?.challenges) {
      return res.json({
        success: true,
        challenges: userData.cachedChallenges.challenges,
        cached: true,
        source: 'mongodb_fallback',
        warning: 'AI limit reached, using cached challenges'
      });
    }
    
    res.json({
      success: true,
      challenges: HACKATHON_CHALLENGES,
      cached: true,
      source: 'hardcoded_fallback'
    });
  }
});

app.get('/api/challenges/active', async (req, res) => {
  const userId = extractUserId(req);
  const userData = await getUserData(userId);
  res.json({
    success: true,
    activeChallenges: userData.activeChallenges || []
  });
});

app.get('/api/challenges/completed', async (req, res) => {
  const userId = extractUserId(req);
  const userData = await getUserData(userId);
  res.json({
    success: true,
    challengesCompleted: userData.challengesCompleted || []
  });
});

app.post('/api/challenges/start', async (req, res) => {
  const userId = extractUserId(req);
  const { challengeId, title, description, category, difficulty, duration, ecoPoints, co2Reduction, icon } = req.body;

  const userData = await getUserData(userId);
  const today = new Date().toISOString().split('T')[0];

  const newChallenge = {
    id: challengeId,
    title,
    description,
    category,
    difficulty,
    duration,
    ecoPoints,
    co2Reduction,
    icon,
    startedAt: today,
    totalDays: parseInt(duration) || 7,
    daysCompleted: [],
    progress: 0
  };

  const activeChallenges = [...(userData.activeChallenges || []), newChallenge];
  await updateUserData(userId, { activeChallenges });

  res.json({
    success: true,
    activeChallenge: newChallenge
  });
});

app.post('/api/challenges/checkin', async (req, res) => {
  const userId = extractUserId(req);
  const { challengeId } = req.body;
  const userData = await getUserData(userId);
  const today = new Date().toISOString().split('T')[0];

  let activeChallenges = userData.activeChallenges || [];
  const challengeIndex = activeChallenges.findIndex(c => c.id === challengeId);

  if (challengeIndex === -1) {
    return res.status(404).json({ success: false, message: 'Challenge not found' });
  }

  const challenge = activeChallenges[challengeIndex];

  if (challenge.daysCompleted?.includes(today)) {
    return res.json({ success: true, message: 'Already checked in today' });
  }

  challenge.daysCompleted = [...(challenge.daysCompleted || []), today];
  challenge.progress = Math.round((challenge.daysCompleted.length / challenge.totalDays) * 100);

  const isComplete = challenge.daysCompleted.length >= challenge.totalDays;

  if (isComplete) {
    activeChallenges = activeChallenges.filter(c => c.id !== challengeId);
    const completedChallenge = {
      ...challenge,
      completedAt: new Date().toISOString()
    };
    const challengesCompleted = [...(userData.challengesCompleted || []), completedChallenge];

    const ecoPoints = (userData.totalEcoPoints || 0) + (challenge.ecoPoints || 100);
    const co2Saved = (userData.totalCo2Saved || 0) + (parseFloat(challenge.co2Reduction) || 0);

    await updateUserData(userId, {
      activeChallenges,
      challengesCompleted,
      totalEcoPoints: Math.round(ecoPoints),
      totalCo2Saved: Math.round(co2Saved * 100) / 100
    });

    const newBadges = await checkAndAwardBadges(userId);

    return res.json({
      success: true,
      isComplete: true,
      completedChallenge,
      ecoPoints,
      co2Saved,
      newBadges
    });
  }

  activeChallenges[challengeIndex] = challenge;
  await updateUserData(userId, { activeChallenges });

  res.json({
    success: true,
    isComplete: false,
    challenge
  });
});

app.post('/api/challenges/complete', async (req, res) => {
  const userId = extractUserId(req);

  const validationErrors = validateChallengeCompletion(req.body);
  if (validationErrors.length > 0) {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'Invalid challenge data',
      details: validationErrors
    });
  }

  const { challengeId, challengeTitle, co2Reduction } = req.body;

  const updated = await addChallengeProgress(userId, challengeId, challengeTitle || challengeId, parseFloat(co2Reduction) || 0);
  const newBadges = await checkAndAwardBadges(userId);

  res.json({
    success: true,
    message: 'Challenge completed!',
    ecoPoints: updated.totalEcoPoints,
    co2Saved: updated.totalCo2Saved,
    streak: updated.streak,
    badges: updated.badges,
    newBadges: newBadges,
    weeklyProgress: updated.weeklyProgress
  });
});

// ============================================
// LEADERBOARD
// ============================================
app.get('/api/leaderboard', async (req, res) => {
  const users = await User.find({
    userId: { $ne: 'default' },
    name: { $exists: true, $ne: null, $ne: '' }
  }).sort({ totalEcoPoints: -1 }).limit(50);

  const leaderboard = users.map(u => ({
    userId: u.userId,
    name: u.name,
    avatar: u.avatar || '🌱',
    ecoPoints: u.totalEcoPoints || 0,
    co2Saved: u.totalCo2Saved || 0,
    streak: u.streak || 0,
    badges: u.badges || [],
    carbonFootprint: u.carbonFootprint
  }));

  res.json({ success: true, leaderboard });
});

// ============================================
// USER PROFILE - FIXED
// ============================================
app.get('/api/user/profile', async (req, res) => {
  const userId = extractUserId(req);
  console.log(`[PROFILE] Fetching profile for userId: ${userId}`);
  
  const userData = await getUserData(userId);

  if (!userData.loginHistory?.includes(new Date().toISOString().split('T')[0])) {
    await recordLogin(userId);
  }

  await checkAndAwardBadges(userId);

  const freshData = await getUserData(userId);
  const levelInfo = getLevelInfo(freshData.totalEcoPoints || 0);

  console.log(`[PROFILE] onboardingComplete: ${freshData.onboardingComplete}, age: ${freshData.age}`);

  res.json({
    success: true,
    profile: {
      userId,
      name: freshData.name || null,
      displayName: freshData.name || null,
      email: freshData.email || null,
      avatar: freshData.avatar || null,
      picture: freshData.avatar || null,
      joinDate: freshData.joinDate ? freshData.joinDate.split('T')[0] : new Date().toISOString().split('T')[0],
      currentStreak: freshData.streak ?? 0,
      totalCo2Saved: freshData.totalCo2Saved ?? 0,
      ecoPoints: freshData.totalEcoPoints ?? 0,
      totalEcoPoints: freshData.totalEcoPoints ?? 0,
      badges: freshData.badges || [],
      level: levelInfo.currentLevel,
      levelProgress: levelInfo,
      weeklyProgress: freshData.weeklyProgress || [0, 0, 0, 0, 0, 0, 0],
      lastWeekReset: freshData.lastWeekReset,
      recentActivity: generateRecentActivity(freshData),
      carbonFootprint: freshData.carbonFootprint || null,
      onboardingComplete: freshData.onboardingComplete || false,
      age: freshData.age || null,
      ageGroup: freshData.ageGroup || null,
      challengesCompleted: freshData.challengesCompleted || [],
      lastActivity: freshData.lastActivity,
      lastLoginDate: freshData.lastLoginDate,
      insights: freshData.insights || null,
      carbonHistory: freshData.carbonHistory || [],
      activeChallenges: freshData.activeChallenges || [],
      calculations: freshData.calculations || [],
      dashboardCache: freshData.dashboardCache || null,
      manualData: freshData.manualData || null,
      cachedChallenges: freshData.cachedChallenges || null
    }
  });
});

app.patch('/api/user/profile', async (req, res) => {
  const userId = extractUserId(req);
  const updates = req.body;

  const updated = await updateUserData(userId, updates);
  const levelInfo = getLevelInfo(updated.totalEcoPoints || 0);

  res.json({
    success: true,
    profile: {
      ...updated.toObject(),
      level: levelInfo.currentLevel,
      levelProgress: levelInfo
    }
  });
});

// ============================================
// 404 HANDLER
// ============================================
app.use((req, res) => {
  console.log(`404 Not Found: ${req.method} ${req.path}`);
  res.status(404).json({
    success: false,
    error: 'NOT_FOUND',
    message: `Route ${req.method} ${req.path} not found`,
    availableRoutes: [
      'GET /',
      'GET /api/health',
      'POST /api/auth/login',
      'POST /api/carbon/manual',
      'GET /api/carbon/footprint',
      'PATCH /api/carbon/footprint',
      'GET /api/carbon/factors',
      'POST /api/carbon/calculate',
      'GET /api/ai/insights',
      'POST /api/ai/insights',
      'POST /api/ai/chat',
      'GET /api/challenges',
      'POST /api/challenges/start',
      'POST /api/challenges/checkin',
      'POST /api/challenges/complete',
      'GET /api/challenges/active',
      'GET /api/challenges/completed',
      'GET /api/leaderboard',
      'GET /api/user/profile',
      'PATCH /api/user/profile'
    ]
  });
});

// ============================================
// ERROR HANDLER
// ============================================
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    error: 'SERVER_ERROR',
    message: err.message
  });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log(`Atmos AI Backend running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`MongoDB: ${MONGODB_URI ? 'configured' : 'NOT CONFIGURED'}`);
  console.log(`AI Manager: Loaded via ai-manager.js`);
});
