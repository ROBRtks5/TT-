
/**
 * TITAN TRADING BOT - CONSTANTS
 * ---------------------------------------------------------
 * @module constants.ts
 * @version 44.1.0 (ALGO REFINEMENT)
 * ---------------------------------------------------------
 */

// SYNC: Must match meta.version in TITAN_MEMORY.json exactly
export const PROJECT_VERSION = '44.2.0 (STABILITY RENAISSANCE)';

// --- FIXED RISK PROTOCOL (USER SPECIFIC) ---
// 1.0 = x1 Leverage (NO MARGIN). 
export const FIXED_RISK_RATE = 1.0; 

// --- TARGET INSTRUMENT (SOURCE OF TRUTH) ---
// T-Technologies (Т-Банк) - Тикер "T"
export const TARGET_INSTRUMENT = 'T';

// --- AMM MARKET MAKER CONFIG (NEW PROTOCOL) ---
export const AMM_CONFIG = {
    GRID_LEVELS: 5,           // Количество ступеней лестницы в каждую сторону
    MIN_ORDER_SPREAD: 0.001,  // Минимальный отступ первого ордера (0.1%)
    VOLATILITY_SMOOTHING: 14, // Период для расчета волатильности
    MAX_GRID_WIDTH_PRCT: 0.05, // Максимальный размах сетки (5%)
    ORDER_MAX_AGE_MS: 10 * 60 * 1000 // TITAN-IRONCLAD: Максимальный возраст ордера (10 мин)
};

// FLAG: Zero Fee Mode (True for T-Bank Employees)
// Set to FALSE if you pay commissions, to enable Breakeven Guards.
export const IS_ZERO_FEE = true;

// Standard T-Invest Fee is 0.05% (0.0005). Roundtrip is ~0.1%.
export const BROKER_FEE_PERCENT = IS_ZERO_FEE ? 0 : 0.0005;

export const STOCK_INFO = {
    ticker: TARGET_INSTRUMENT,
    name: 'Т-Технологии (Акции)',
    lotSize: 1, // Usually 1, strictly checked via API
    minPriceIncrement: 0.1 
};

export const TINVEST_APP_NAME = 'titan-trading-bot';

// --- RISK MANAGEMENT ---
export const MAX_LEVERAGE = 1; 
export const DAILY_LOSS_LIMIT = 5; 
export const DAILY_DRAWDOWN_LIMIT_PERCENT = 0.05; 

// --- DATA CONFIG ---
export const ROLLING_VWAP_WINDOW = 240; 
export const MAX_HISTORY_ITEMS = 1000;
export const MAX_POSITION_HOLD_TIME_MS = 24 * 60 * 60 * 1000; 
export const STAGNANT_PROFIT_THRESHOLD = 0.002; 
export const BACKUP_WARNING_THRESHOLD_MS = 24 * 60 * 60 * 1000; 

// --- NETWORK RESILIENCE ---
export const MAX_STREAM_STRIKES = 20; 
export const PULSE_TIMEOUT_MS = 120000; 
export const DATA_STALE_TIMEOUT_MS = 600000; 
export const MOBILE_SLEEP_DETECTION_MS = 30000; 

// --- INTEGRITY GATES ---
export const HARD_SYNC_INTERVAL_MS = 5 * 60 * 1000; 

// --- UI PERFORMANCE CONFIG ---
// OPTIMIZED: Set to 250ms (4 FPS) to reduce battery drain on mobile
// Used by BotKernel to throttle state updates to the main thread.
export const UI_UPDATE_THROTTLE_MS = 250; 

// --- API KEYS DEFAULTS ---
export const DEFAULT_NEWS_API_KEY = "e658d758de3a42d7b26220c0120f3703"; 

// --- MARKET TIME (MSK) ---
// UPD: Set to 06:55 to catch the 07:00 Morning Session Start
export const SESSION_WARMUP_HOUR = 6;
export const SESSION_WARMUP_MINUTE = 55; 
export const SUNSET_TWILIGHT_HOUR = 23; 
export const SUNSET_TWILIGHT_MINUTE = 40; 
// UPD: Set to 23:50 to match official Evening Session Close
export const SUNSET_HARD_CLOSE_HOUR = 23;
export const SUNSET_HARD_CLOSE_MINUTE = 50; 

// --- TEXT ---
export const TRADING_ANECDOTES = [
    "Тише едешь - дальше будешь.",
    "Рынок перераспределяет деньги от активных к терпеливым.",
    "Лучшая сделка - та, которую ты не закрыл в минус.",
    "План прост: Купить и держать."
];

// --- THRESHOLDS & PARAMS ---
// CRITICAL FIX: Increased buffer to 2% (0.98) for CASH ONLY mode.
// Even with 0 fees, we need this to avoid API rejection on price fluctuation.
export const BUYING_POWER_SAFETY_MARGIN = 0.98; 
export const HYPOTHETICAL_EVALUATION_PERIOD_MS = 60 * 60 * 1000; 
export const MARGIN_LENDING_DAILY_RATE = 0.0005; 

// --- RATCHET & BUNKER CONFIG (NEW) ---
export const BUNKER_CONFIG = {
    RATCHET_ACTIVATION_PNL: 0.005, // Start trailing after +0.5% profit
    RATCHET_TRAILING_DIST: 0.003,  // Keep 0.3% distance when trailing
    PANIC_RSI_THRESHOLD: 75,       // Trigger "Safe Limit Exit" if RSI > 75
    PANIC_BB_BREAK_THRESHOLD: 1.01 // Trigger if Price > BB Upper * 1.01
};

export const MOEX_ISS_BASE_URL = 'https://iss.moex.com/iss';
