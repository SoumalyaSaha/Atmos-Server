const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');

// ============================================
// API KEY CONFIGURATION — 7 Keys Total
// ============================================

const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
].filter(Boolean);

const GROQ_KEYS = [
  process.env.GROQ_API_KEY_1,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
].filter(Boolean);

// ============================================
// RATE LIMITING & USAGE TRACKING
// ============================================

const keyUsage = {
  gemini: new Array(GEMINI_KEYS.length).fill(0),
  groq: new Array(GROQ_KEYS.length).fill(0),
};

const DAILY_LIMIT_PER_KEY = 60;
let globalRequestCount = 0;
const GLOBAL_DAILY_LIMIT = 400;
const userRequestCounts = new Map();
let lastGeminiIndex = -1;
let lastGroqIndex = -1;

let aiStatus = {
  gemini: { available: GEMINI_KEYS.length > 0, activeKeys: GEMINI_KEYS.length, failedKeys: [] },
  groq: { available: GROQ_KEYS.length > 0, activeKeys: GROQ_KEYS.length, failedKeys: [] },
  overall: 'healthy',
  lastCheck: new Date().toISOString(),
};

const disabledKeys = new Set();

// ============================================
// HELPERS
// ============================================

function getToday() {
  return new Date().toISOString().split('T')[0];
}

function resetDailyCounters() {
  keyUsage.gemini.fill(0);
  keyUsage.groq.fill(0);
  globalRequestCount = 0;
  userRequestCounts.clear();
  disabledKeys.clear();
  console.log('[AI-MANAGER] Daily counters reset');
}

setInterval(() => {
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    resetDailyCounters();
  }
}, 60000);

function getNextAvailableKey(provider) {
  const keys = provider === 'gemini' ? GEMINI_KEYS : GROQ_KEYS;
  const usage = provider === 'gemini' ? keyUsage.gemini : keyUsage.groq;
  const lastIndex = provider === 'gemini' ? lastGeminiIndex : lastGroqIndex;
  
  for (let i = 0; i < keys.length; i++) {
    const idx = (lastIndex + 1 + i) % keys.length;
    const keyId = `${provider}:${idx}`;
    
    if (disabledKeys.has(keyId)) continue;
    if (usage[idx] >= DAILY_LIMIT_PER_KEY) continue;
    
    if (provider === 'gemini') lastGeminiIndex = idx;
    else lastGroqIndex = idx;
    
    return { key: keys[idx], index: idx, provider };
  }
  return null;
}

function markKeyFailed(provider, index) {
  const keyId = `${provider}:${index}`;
  disabledKeys.add(keyId);
  console.warn(`[AI-MANAGER] Key disabled: ${keyId}`);
  
  if (provider === 'gemini') {
    aiStatus.gemini.failedKeys.push(index);
    if (aiStatus.gemini.failedKeys.length >= GEMINI_KEYS.length) {
      aiStatus.gemini.available = false;
    }
  } else {
    aiStatus.groq.failedKeys.push(index);
    if (aiStatus.groq.failedKeys.length >= GROQ_KEYS.length) {
      aiStatus.groq.available = false;
    }
  }
  
  aiStatus.overall = (aiStatus.gemini.available || aiStatus.groq.available) ? 'degraded' : 'down';
  aiStatus.lastCheck = new Date().toISOString();
}

function checkUserRateLimit(userId) {
  const today = getToday();
  const userData = userRequestCounts.get(userId);
  
  if (!userData || userData.date !== today) {
    userRequestCounts.set(userId, { count: 0, date: today });
    return true;
  }
  
  const USER_DAILY_LIMIT = 20;
  if (userData.count >= USER_DAILY_LIMIT) return false;
  
  userData.count++;
  return true;
}

function incrementGlobalCount() {
  globalRequestCount++;
}

// ============================================
// PROVIDER CALLS
// ============================================

async function callGemini(prompt, keyData) {
  const genAI = new GoogleGenerativeAI(keyData.key);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const result = await model.generateContent(prompt);
  const response = await result.response;
  return response.text();
}

async function callGroq(prompt, keyData) {
  const groq = new Groq({ apiKey: keyData.key });
  const completion = await groq.chat.completions.create({
    messages: [
      { role: 'system', content: 'You are Atmos AI, a carbon footprint and sustainability expert.' },
      { role: 'user', content: prompt }
    ],
    model: 'llama-3.1-8b-instant',
    temperature: 0.7,
    max_tokens: 2048,
  });
  return completion.choices[0]?.message?.content || '';
}

// ============================================
// SAFE AI CALL
// ============================================

async function safeAICall(prompt, userId = 'default') {
  if (globalRequestCount >= GLOBAL_DAILY_LIMIT) {
    throw new Error('GLOBAL_RATE_LIMIT_EXCEEDED');
  }
  
  if (!checkUserRateLimit(userId)) {
    throw new Error('USER_RATE_LIMIT_EXCEEDED');
  }
  
  let lastError = null;
  
  for (let attempt = 0; attempt < GEMINI_KEYS.length; attempt++) {
    const keyData = getNextAvailableKey('gemini');
    if (!keyData) break;
    
    try {
      console.log(`[AI] Trying Gemini key ${keyData.index + 1}/${GEMINI_KEYS.length}`);
      const result = await callGemini(prompt, keyData);
      keyUsage.gemini[keyData.index]++;
      incrementGlobalCount();
      console.log(`[AI] Gemini key ${keyData.index + 1} success`);
      return result;
    } catch (error) {
      console.warn(`[AI] Gemini key ${keyData.index + 1} failed:`, error.message);
      lastError = error;
      markKeyFailed('gemini', keyData.index);
    }
  }
  
  for (let attempt = 0; attempt < GROQ_KEYS.length; attempt++) {
    const keyData = getNextAvailableKey('groq');
    if (!keyData) break;
    
    try {
      console.log(`[AI] Trying Groq key ${keyData.index + 1}/${GROQ_KEYS.length}`);
      const result = await callGroq(prompt, keyData);
      keyUsage.groq[keyData.index]++;
      incrementGlobalCount();
      console.log(`[AI] Groq key ${keyData.index + 1} success`);
      return result;
    } catch (error) {
      console.warn(`[AI] Groq key ${keyData.index + 1} failed:`, error.message);
      lastError = error;
      markKeyFailed('groq', keyData.index);
    }
  }
  
  console.error('[AI] ALL API KEYS EXHAUSTED');
  throw new Error('ALL_AI_KEYS_EXHAUSTED');
}

// ============================================
// SAFE AI CHAT
// ============================================

async function safeAIChat(message, history = [], userId = 'default') {
  if (globalRequestCount >= GLOBAL_DAILY_LIMIT) {
    throw new Error('GLOBAL_RATE_LIMIT_EXCEEDED');
  }
  
  if (!checkUserRateLimit(userId)) {
    throw new Error('USER_RATE_LIMIT_EXCEEDED');
  }
  
  let lastError = null;
  
  for (let attempt = 0; attempt < GROQ_KEYS.length; attempt++) {
    const keyData = getNextAvailableKey('groq');
    if (!keyData) break;
    
    try {
      console.log(`[AI-CHAT] Trying Groq key ${keyData.index + 1}/${GROQ_KEYS.length}`);
      const groq = new Groq({ apiKey: keyData.key });
      
      const messages = [
        { role: 'system', content: 'You are Atmos AI, a friendly carbon footprint and sustainability advisor. Be concise, helpful, and encouraging.' },
        ...history,
        { role: 'user', content: message }
      ];
      
      const completion = await groq.chat.completions.create({
        messages,
        model: 'llama-3.1-8b-instant',
        temperature: 0.8,
        max_tokens: 1024,
      });
      
      const reply = completion.choices[0]?.message?.content || '';
      keyUsage.groq[keyData.index]++;
      incrementGlobalCount();
      console.log(`[AI-CHAT] Groq key ${keyData.index + 1} success`);
      return reply;
    } catch (error) {
      console.warn(`[AI-CHAT] Groq key ${keyData.index + 1} failed:`, error.message);
      lastError = error;
      markKeyFailed('groq', keyData.index);
    }
  }
  
  for (let attempt = 0; attempt < GEMINI_KEYS.length; attempt++) {
    const keyData = getNextAvailableKey('gemini');
    if (!keyData) break;
    
    try {
      console.log(`[AI-CHAT] Trying Gemini key ${keyData.index + 1}/${GEMINI_KEYS.length}`);
      const result = await callGemini(
        `You are Atmos AI chatbot. Conversation history:\n${history.map(h => `${h.role}: ${h.content}`).join('\n')}\n\nUser: ${message}\n\nRespond helpfully and concisely.`,
        keyData
      );
      keyUsage.gemini[keyData.index]++;
      incrementGlobalCount();
      console.log(`[AI-CHAT] Gemini key ${keyData.index + 1} success`);
      return result;
    } catch (error) {
      console.warn(`[AI-CHAT] Gemini key ${keyData.index + 1} failed:`, error.message);
      lastError = error;
      markKeyFailed('gemini', keyData.index);
    }
  }
  
  console.error('[AI-CHAT] ALL API KEYS EXHAUSTED');
  throw new Error('ALL_AI_KEYS_EXHAUSTED');
}

// ============================================
// STATUS
// ============================================

function getAIStatus() {
  return {
    ...aiStatus,
    gemini: {
      ...aiStatus.gemini,
      usage: keyUsage.gemini,
      remaining: keyUsage.gemini.map((u, i) => DAILY_LIMIT_PER_KEY - u),
    },
    groq: {
      ...aiStatus.groq,
      usage: keyUsage.groq,
      remaining: keyUsage.groq.map((u, i) => DAILY_LIMIT_PER_KEY - u),
    },
    global: {
      used: globalRequestCount,
      limit: GLOBAL_DAILY_LIMIT,
      remaining: GLOBAL_DAILY_LIMIT - globalRequestCount,
    },
    disabledKeys: Array.from(disabledKeys),
  };
}

function getGeminiModel() {
  if (GEMINI_KEYS.length === 0) return null;
  const genAI = new GoogleGenerativeAI(GEMINI_KEYS[0]);
 return genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  safeAICall,
  safeAIChat,
  getAIStatus,
  getGeminiModel,
  resetDailyCounters,
};
