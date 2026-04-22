
/**
 * TITAN TRADING BOT - MOEX ISS GATEWAY (PROTOCOL HYDRA v2.1)
 * ---------------------------------------------------------
 * @module services/moexService.ts
 * @version 2.3.3 (SANITIZATION)
 * @phase Protocol Hydra (Resilience)
 * @description
 * Service for direct interaction with Moscow Exchange Information Analytical Server (ISS).
 * UPD 2.3.3: Strict Sanitization. Replaces '@' globally to prevent API errors.
 * ---------------------------------------------------------
 */

import { MOEX_ISS_BASE_URL } from '../constants';
import { ChartDataPoint, CandleInterval } from '../types';

// MOEX returns data in a "columns + data" format.
interface MoexResponseBlock {
    columns: string[];
    data: (string | number | null)[][];
}

interface MoexResponse {
    [key: string]: MoexResponseBlock;
}

// --- PROXY ARSENAL (REFRESHED) ---
const PROXY_POOL = [
    'https://api.allorigins.win/raw?url=', 
    'https://corsproxy.io/?',
    'https://api.codetabs.com/v1/proxy?quest=',
    'https://thingproxy.freeboard.io/fetch/',
    'https://cors-anywhere.herokuapp.com/' // Fallback
];

// STATE: Track health of proxies
const proxyHealth = new Map<string, number>(); // URL -> Fail Count
let currentProxyIndex = 0;

// SAFETY LIMITS
const MAX_PAGES_SAFETY_LIMIT = 50; 

/**
 * Diagnostics Helper
 */
export const getDiagnostics = () => {
    let deadProxies = 0;
    proxyHealth.forEach((fails) => {
        if (fails > 3) deadProxies++;
    });
    
    return {
        totalProxies: PROXY_POOL.length,
        currentProxyIndex,
        currentProxy: PROXY_POOL[currentProxyIndex].split('?')[0], // strip params for logs
        deadProxies,
        healthMap: Object.fromEntries(proxyHealth)
    };
};

/**
 * Helper to parse MOEX's efficient but annoying JSON format into an array of objects.
 */
const parseMoexBlock = (block: MoexResponseBlock | undefined): any[] => {
    if (!block || !block.data || !block.columns) return [];
    
    return block.data.map(row => {
        const obj: any = {};
        block.columns.forEach((col, idx) => {
            obj[col] = row[idx];
        });
        return obj;
    });
};

/**
 * INTELLIGENT FETCHER (Auto-Replaceable)
 * Tries proxies in sequence. If one fails, it rotates to the next.
 */
const fetchMoex = async (endpoint: string, params: Record<string, string | number> = {}): Promise<MoexResponse> => {
    const query = new URLSearchParams();
    for (const key in params) {
        query.append(key, String(params[key]));
    }
    const queryString = query.toString();
    const directUrl = `${MOEX_ISS_BASE_URL}${endpoint}.json${queryString ? '?' + queryString : ''}`;
    
    // 1. Try Direct First (Best Case - if user has local CORS plugin)
    try {
        const response = await fetch(directUrl);
        if (response.ok) return await response.json();
    } catch (e) {
        // Direct failed, proceed to proxies
    }

    // 2. Try Proxies (Smart Rotation)
    let attempts = 0;
    const maxAttempts = PROXY_POOL.length;

    while (attempts < maxAttempts) {
        const proxyPrefix = PROXY_POOL[currentProxyIndex];
        const failCount = proxyHealth.get(proxyPrefix) || 0;

        // Skip if this proxy is "burned" (failed > 3 times recently)
        if (failCount > 3) {
            currentProxyIndex = (currentProxyIndex + 1) % PROXY_POOL.length;
            attempts++;
            continue;
        }

        try {
            const proxyUrl = `${proxyPrefix}${encodeURIComponent(directUrl)}`;
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout

            const response = await fetch(proxyUrl, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const json = await response.json();
            
            // Success! Heal this proxy score
            proxyHealth.set(proxyPrefix, Math.max(0, failCount - 1));
            return json;

        } catch (e) {
            // Failure
            proxyHealth.set(proxyPrefix, failCount + 1);
            // Don't spam logs for every proxy fail, only rotation
            currentProxyIndex = (currentProxyIndex + 1) % PROXY_POOL.length;
            attempts++;
        }
    }
    
    throw new Error("All MOEX gateways exhausted.");
};

/**
 * Maps app-specific candle intervals to MOEX ISS API interval codes.
 */
const mapAppIntervalToMoex = (interval: CandleInterval): number | null => {
    const mapping: Record<string, number | null> = {
        '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': null, '1d': 24,
    };
    return mapping[interval] ?? null;
};


/**
 * Fetches historical candles from MOEX with pagination.
 */
export const fetchHistoryCandles = async (
    ticker: string,
    interval: CandleInterval,
    from: Date,
    to: Date
): Promise<ChartDataPoint[]> => {
    const moexInterval = mapAppIntervalToMoex(interval);
    if (moexInterval === null) return [];

    // CLEAN TICKER: MOEX does not support '@' suffixes
    const cleanTicker = ticker.replace('@', '');

    const endpoint = `/engines/stock/markets/shares/securities/${cleanTicker}/candles`;

    let allCandles: any[] = [];
    let start = 0;
    const limit = 500;
    let pageCount = 0;

    while (true) {
        if (pageCount >= MAX_PAGES_SAFETY_LIMIT) break;

        const params = {
            from: from.toISOString().split('T')[0],
            till: to.toISOString().split('T')[0],
            interval: moexInterval,
            start: start,
            limit: limit
        };

        try {
            const response = await fetchMoex(endpoint, params);
            const candlesBlock = response['candles'];
            const parsed = parseMoexBlock(candlesBlock);

            if (parsed.length === 0) break;

            allCandles = allCandles.concat(parsed);
            start += parsed.length;
            pageCount++;

            if (parsed.length < limit) break;
            
            // THROTTLING to prevent IP Ban
            await new Promise(r => setTimeout(r, 300)); 

        } catch (e) {
            console.warn(`[Hydra] History fetch interrupted at page ${pageCount}.`);
            break;
        }
    }

    return allCandles.map(c => ({
        time: new Date(String(c.begin).replace(' ', 'T')).getTime(),
        open: c.open,
        price: c.close,
        high: c.high,
        low: c.low,
        volume: c.volume,
    }));
};
