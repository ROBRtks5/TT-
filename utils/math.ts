
/**
 * TITAN TRADING BOT - MATH CORE
 * ---------------------------------------------------------
 * @module utils/math.ts
 * @description
 * Библиотека для безопасных операций с плавающей запятой (IEEE 754).
 * Устраняет ошибки вида 0.1 + 0.2 !== 0.3.
 * ---------------------------------------------------------
 */

// Epsilon for general float comparison (1 nano-unit)
export const EPSILON = 0.000000001;

export const areEqual = (a: number, b: number, epsilon: number = EPSILON): boolean => {
    return Math.abs(a - b) < epsilon;
};

export const isGreater = (a: number, b: number, epsilon: number = EPSILON): boolean => {
    return a > b + epsilon;
};

export const isLess = (a: number, b: number, epsilon: number = EPSILON): boolean => {
    return a < b - epsilon;
};

export const isGreaterOrEqual = (a: number, b: number, epsilon: number = EPSILON): boolean => {
    return a > b - epsilon;
};

export const isLessOrEqual = (a: number, b: number, epsilon: number = EPSILON): boolean => {
    return a < b + epsilon;
};

export const safeRound = (value: number, decimals: number): number => {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
};

/**
 * Calculates the number of decimal places in a number.
 * e.g. 0.01 -> 2, 0.005 -> 3, 1 -> 0
 */
const getDecimals = (value: number): number => {
    if (Math.floor(value) === value) return 0;
    const str = value.toString();
    if (str.includes('e-')) {
        return parseInt(str.split('e-')[1], 10);
    }
    return str.split('.')[1]?.length || 0;
};

/**
 * STRICT TICK ROUNDING (PRECISION CORRECTED)
 * Aligns price to the grid defined by minPriceIncrement.
 * Enforces strict decimal limits to please the Exchange API.
 */
export const roundPriceToTick = (price: number, tick: number): number => {
    // FALLBACK: If tick is invalid, default to 0.01 (2 decimals) as requested
    const safeTick = (tick && tick > 0) ? tick : 0.01;
    
    if (!Number.isFinite(price)) return 0;

    const decimals = getDecimals(safeTick);
    
    // 1. Align to tick grid
    // We add EPSILON before flooring/rounding to handle 0.9999999 cases
    const ratio = price / safeTick;
    const roundedRatio = Math.round(ratio + EPSILON);
    const aligned = roundedRatio * safeTick;
    
    // 2. Fix floating point drift (e.g. 150.1 * 3 = 450.2999999999)
    // We strictly cut to the tick's precision using toFixed, then parse back.
    // This is the only way to guarantee "clean" numbers for the API.
    return parseFloat(aligned.toFixed(decimals));
};

/**
 * PROTOCOL EQUINOX: Normalizes Futures price relative to Spot price.
 * Fixes the 100x multiplier discrepancy (e.g. 2700 vs 270000).
 */
export const normalizeFuturesPrice = (futuresPrice: number, spotPrice: number): number => {
    if (!spotPrice || spotPrice <= 0 || !futuresPrice) return futuresPrice;
    
    // Heuristic: If ratio > 50, assume it's a 100x multiplier contract.
    if (futuresPrice / spotPrice > 50) {
        return futuresPrice / 100;
    }
    return futuresPrice;
};

/**
 * WAVE 39: AI CONTEXT SANITIZER
 */
export const formatAIValue = (val: number | null | undefined, decimals: number = 2, fallback: string = 'N/A'): string => {
    if (val === null || val === undefined || !Number.isFinite(val)) {
        return fallback;
    }
    return val.toFixed(decimals);
};
