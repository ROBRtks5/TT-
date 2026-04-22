
/**
 * TITAN TRADING BOT - TIME SYNC UTILITY
 * ---------------------------------------------------------
 * @module services/timeSyncService.ts
 * @version 6.30.0
 * @phase Ouroboros Phase 1
 * @description
 * Утилита для проверки синхронности данных между Спотом и Фьючерсом.
 * Предотвращает "Торговлю Призраками" (Ghost Trading) при лагах сети.
 * UPD 6.30.0: Threshold relaxed to 5000ms for mobile network stability.
 * ---------------------------------------------------------
 */

// Max allowed delay between two data points to consider them "synchronous"
const MAX_SYNC_DELAY_MS = 5000;

/**
 * Checks if two timestamps are within the acceptable synchronization window.
 * @param timestamp1 Time of Spot Data
 * @param timestamp2 Time of Futures Data
 * @param thresholdMs Custom threshold (default 5000ms)
 * @returns boolean True if synchronized
 */
export const isSynchronized = (timestamp1: number | null | undefined, timestamp2: number | null | undefined, thresholdMs: number = MAX_SYNC_DELAY_MS): boolean => {
    if (!timestamp1 || !timestamp2) return false;
    const delta = Math.abs(timestamp1 - timestamp2);
    return delta <= thresholdMs;
};

/**
 * Validates if a single data point is fresh relative to "Now".
 * @param dataTimestamp Time of data
 * @param maxAgeMs Max acceptable age (default 10s)
 */
export const isDataFresh = (dataTimestamp: number | null | undefined, maxAgeMs: number = 10000): boolean => {
    if (!dataTimestamp) return false;
    return (Date.now() - dataTimestamp) <= maxAgeMs;
};
