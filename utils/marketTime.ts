
/**
 * TITAN TRADING BOT - TIME UTILS
 * ---------------------------------------------------------
 * @module utils/marketTime.ts
 * @version 6.40.0 (TIME TRAVEL CAPABLE)
 * @phase Protocol Calendar
 * @last-updated 2026-01-05
 * @description
 * Утилиты для работы со временем Московской Биржи (UTC+3).
 * UPD 6.40.0: Added customTime support for deterministic testing.
 * ---------------------------------------------------------
 */

import { SUNSET_TWILIGHT_HOUR, SUNSET_TWILIGHT_MINUTE, SUNSET_HARD_CLOSE_HOUR, SUNSET_HARD_CLOSE_MINUTE, SESSION_WARMUP_HOUR, SESSION_WARMUP_MINUTE } from '../constants';

const MORNING_START_HOUR = 7;
const MAIN_START_HOUR = 10;
const EVENING_START_HOUR = 19;
const CLOSE_HOUR = 23; 
const CLOSE_MINUTE = 50;

// GLOBAL DELTA (Client Time - Server Time)
let serverTimeDelta: number = 0;

export type SunsetStatus = 'OPEN' | 'TWILIGHT' | 'HARD_CLOSE' | 'CLOSED';

/**
 * Sets the offset between Client Clock and Server Clock.
 * @param serverTime Date object from API header
 */
export const setServerTimeDelta = (serverTime: Date): void => {
    const localNow = Date.now();
    const serverNow = serverTime.getTime();
    serverTimeDelta = serverNow - localNow;
    console.log(`[TimeSync] ⏳ Delta calibrated: ${serverTimeDelta}ms`);
};

/**
 * Returns current Server Time (Estimated).
 */
export const getServerTimeNow = (): number => {
    return Date.now() + serverTimeDelta;
};

/**
 * Returns current Server Date object (Estimated).
 */
export const getServerDate = (): Date => {
    return new Date(getServerTimeNow());
};

/**
 * UNIVERSAL TIME PROTOCOL:
 * Calculates Moscow time using raw UTC offset (+3 hours) relative to Server Time.
 * @param customServerTime Optional timestamp to simulate time (for testing)
 */
export const getMoscowParts = (customServerTime?: number) => {
    // 1. Get synchronized UTC timestamp (or use custom for testing)
    const nowEpoch = customServerTime !== undefined ? customServerTime : getServerTimeNow();
    
    // 2. Create a date object. 
    // Moscow is ALWAYS UTC+3. No DST.
    const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
    
    // We create a "Virtual Moscow Date" by shifting the epoch.
    const mskVirtualDate = new Date(nowEpoch + MSK_OFFSET_MS);

    const hours = mskVirtualDate.getUTCHours();
    const minutes = mskVirtualDate.getUTCMinutes();
    const day = mskVirtualDate.getUTCDay(); // 0=Sun, 1=Mon...
    
    const isoStr = mskVirtualDate.toISOString().replace('T', ' ').substring(0, 19);

    return {
        hours,
        minutes,
        day,
        fullStr: isoStr
    };
};

/**
 * MARKET GUARD: STRICT WEEKEND CHECK
 * Returns true if it is Saturday or Sunday.
 */
export const isWeekend = (customTime?: number): boolean => {
    const { day } = getMoscowParts(customTime);
    return day === 0 || day === 6;
};

/**
 * MARKET GUARD: LIVENESS HEURISTIC
 * Returns true if the market seems alive based on recent trades.
 * Used to detect holidays or technical halts during working hours.
 * @param lastTradeTime Timestamp of the last trade received
 */
export const isMarketAlive = (lastTradeTime: number): boolean => {
    // If no trade data ever received, we can't judge liveness yet.
    // However, if we are mid-session, this usually means data is stale or market is dead.
    if (!lastTradeTime) return false;
    
    const now = getServerTimeNow();
    const diff = now - lastTradeTime;
    
    // Tolerance: 15 minutes of silence.
    // If no trades for 15 mins during "Open" hours, we assume Market is effectively Closed/Holiday.
    return diff < 15 * 60 * 1000;
};

/**
 * PROTOCOL BREAK:
 * Detects the Morning Break (09:40 - 09:50).
 * Valid for Stocks.
 */
export const isMorningBreak = (customTime?: number): boolean => {
    const { hours, minutes } = getMoscowParts(customTime);
    if (isWeekend(customTime)) return false;
    
    // 09:40 to 09:50 (Exclusive of 09:50)
    return hours === 9 && minutes >= 40 && minutes < 50;
};

/**
 * PROTOCOL TWILIGHT:
 * Detects the Evening Clearing Gap/Auction (18:55 - 19:00).
 * Valid for BOTH Stocks and Funds.
 */
export const isClearingState = (customTime?: number): boolean => {
    const { hours, minutes } = getMoscowParts(customTime);
    if (isWeekend(customTime)) return false;

    const totalMins = hours * 60 + minutes;
    // New MOEX Schedule: Main ends at 18:54:59, Auction until 18:59:30.
    const startMins = 18 * 60 + 55; // 1135 (18:55)
    const endMins = 19 * 60;        // 1140 (19:00)
    
    return totalMins >= startMins && totalMins < endMins;
};

/**
 * Check if a specific instrument class is allowed to trade RIGHT NOW.
 * @param classCode Instrument Class (TQBR for Stocks, TQTF for Funds)
 * @param customTime Optional timestamp for testing
 */
export const isTradeAllowedForInstrument = (classCode: string = '', customTime?: number): boolean => {
    const { hours, minutes } = getMoscowParts(customTime);
    
    if (isWeekend(customTime)) return false;
    if (isClearingState(customTime)) return false; // 18:40 - 19:00 Closed for everyone
    if (getSunsetStatus(customTime) === 'CLOSED') return false; // > 23:50 Closed

    const totalMins = hours * 60 + minutes;

    // --- FUNDS (TQTF) ---
    // Rule: NO Morning Session. Start at 10:00.
    if (classCode === 'TQTF') {
        const startMins = 10 * 60; // 10:00
        if (totalMins < startMins) return false; // Sleeping before 10:00
        return true; 
    }

    // --- STOCKS (TQBR) ---
    // Rule: Open 07:00. Break 09:40-09:50.
    if (classCode === 'TQBR' || classCode === '') { // Default assume Stock logic
        // 07:00 Check (Implicit in getSunsetStatus if config is correct, but safer here)
        if (totalMins < 7 * 60) return false;
        
        // Morning Break Check
        if (isMorningBreak(customTime)) return false;
        
        return true;
    }

    return true;
};

export const getSunsetStatus = (customTime?: number): SunsetStatus => {
    const { hours, minutes } = getMoscowParts(customTime);

    // Weekend = CLOSED
    if (isWeekend(customTime)) return 'CLOSED';
    
    // Breaks = CLOSED (Global checks only, instrument specific checks handled in Strategy)
    if (isClearingState(customTime)) return 'CLOSED';

    const currentMins = hours * 60 + minutes;
    const closeMins = CLOSE_HOUR * 60 + CLOSE_MINUTE; // 23:50
    const hardCloseMins = SUNSET_HARD_CLOSE_HOUR * 60 + SUNSET_HARD_CLOSE_MINUTE;
    const twilightMins = SUNSET_TWILIGHT_HOUR * 60 + SUNSET_TWILIGHT_MINUTE;
    const openMins = SESSION_WARMUP_HOUR * 60 + SESSION_WARMUP_MINUTE; // 06:55

    if (currentMins >= closeMins || currentMins < openMins) return 'CLOSED';
    if (currentMins >= hardCloseMins) return 'HARD_CLOSE';
    if (currentMins >= twilightMins) return 'TWILIGHT';

    return 'OPEN';
};

// NEW: Detailed diagnostics for the widget
export const getDetailedSessionStatus = () => {
    const { hours, minutes, day } = getMoscowParts();
    const currentMins = hours * 60 + minutes;
    const openMins = SESSION_WARMUP_HOUR * 60 + SESSION_WARMUP_MINUTE;
    
    const dayName = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][day];
    
    if (isWeekend()) {
        return { 
            code: 'WEEKEND', 
            text: `ВЫХОДНОЙ (${dayName})`, 
            sub: 'РЫНОК ЗАКРЫТ' 
        };
    }
    
    if (currentMins < openMins) {
        const diff = openMins - currentMins;
        const h = Math.floor(diff / 60);
        const m = diff % 60;
        return {
            code: 'PRE_OPEN',
            text: 'ДО ОТКРЫТИЯ',
            sub: `-${h}ч ${m}м`
        };
    }
    
    if (isMorningBreak()) {
        return { code: 'BREAK', text: 'ПЕРЕРЫВ', sub: '09:40 - 09:50' };
    }

    if (isClearingState()) {
        return { code: 'CLEARING', text: 'КЛИРИНГ / АУКЦИОН', sub: '18:55 - 19:00' };
    }
    
    const status = getSunsetStatus();
    if (status === 'CLOSED') {
        return { code: 'CLOSED', text: 'ТОРГИ ОКОНЧЕНЫ', sub: 'ЖДЕМ УТРА' };
    }
    
    // Determine exact session
    let sessionName = 'УТРЕННЯЯ';
    if (hours >= 9 && minutes >= 50) sessionName = 'ПРЕ-МАРКЕТ'; // 9:50 - 10:00
    if (hours >= 10) sessionName = 'ОСНОВНАЯ';
    if (hours >= 19) sessionName = 'ВЕЧЕРНЯЯ';
    
    return { code: 'OPEN', text: 'ТОРГИ ИДУТ', sub: sessionName };
};

/**
 * PROTOCOL HYPNOS: DEEP SLEEP CHECK
 * Returns TRUE if it is between 00:00 and 06:00 MSK.
 */
export const isDeepNight = (): boolean => {
    const { hours } = getMoscowParts();
    // 00:00 to 05:59 -> Deep Night
    if (hours >= 0 && hours < 6) return true;
    return false;
};

/**
 * Calculates milliseconds until 07:00 MSK.
 */
export const getMsToMorning = (): number => {
    const { hours, minutes } = getMoscowParts();
    const currentMins = hours * 60 + minutes;
    const targetMins = 7 * 60; // 07:00 -> 420 mins
    
    let diffMins = 0;
    if (currentMins < targetMins) {
        diffMins = targetMins - currentMins;
    } else {
        diffMins = (24 * 60 - currentMins) + targetMins;
    }
    return diffMins * 60 * 1000;
};

/**
 * UI Helper: General Check
 */
export const isMarketOpenNow = (): boolean => {
    if (isClearingState()) return false;
    // Note: isMorningBreak is stock specific, but for general UI 'Open' usually implies 'Some session is open'
    // But to be safe, if we are in morning break, UI should say break.
    if (isMorningBreak()) return false;
    return getSunsetStatus() !== 'CLOSED';
};

export const getMoscowTimestampForAI = (): string => {
    const { fullStr } = getMoscowParts();
    return `${fullStr} (MSK)`;
};

export const getMsUntilNextSessionOpen = (): number | null => {
    const { hours, minutes } = getMoscowParts();
    
    if (isWeekend()) return null;

    const currentTotalMinutes = hours * 60 + minutes;
    
    if (isMarketOpenNow()) return 0;
    
    // 1. Morning Open (Now 06:55 Warmup for 07:00)
    const warmUpStartMins = SESSION_WARMUP_HOUR * 60 + SESSION_WARMUP_MINUTE;
    if (currentTotalMinutes < warmUpStartMins) {
        return (warmUpStartMins - currentTotalMinutes) * 60 * 1000;
    }
    
    // 2. Pre-Market after Break (09:50)
    if (isMorningBreak()) {
        const target = 9 * 60 + 50;
        return (target - currentTotalMinutes) * 60 * 1000;
    }

    // 3. Evening Open (After Clearing)
    const eveningStartMins = 19 * 60;
    if (isClearingState()) {
        return (eveningStartMins - currentTotalMinutes) * 60 * 1000;
    }
    
    return null; 
};

// End of file
