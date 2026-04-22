
/**
 * TITAN TRADING BOT - API TRANSPORT
 * ---------------------------------------------------------
 * @module services/tInvestApi.ts
 * @version 13.2.0 (AMBIGUOUS ERROR DETECTION)
 * ---------------------------------------------------------
 */

import { TINVEST_APP_NAME } from '../constants';
import { ApiGetAccountsResponse } from '../types';

const API_BASE_URL = 'https://invest-public-api.tinkoff.ru/rest/';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 15000; // TITAN-IRONCLAD: Dropped from 45s to 15s. Fail fast to avoid queue stalling.

// --- TRAFFIC CONTROL CONFIG ---
let currentRequestIntervalMs = 333; // ~3 requests/sec max globally. Safety first.

export const setApiThrottle = (ms: number) => {
    currentRequestIntervalMs = ms;
    console.log(`[API] Throttle adjusted to ${ms}ms per request.`);
};

// --- CIRCUIT BREAKER STATE ---
let isGlobalCooldown = false;
let globalCooldownResetTime = 0;

const COOLDOWN_CRITICAL_MS = 5000;   
const COOLDOWN_TRANSIENT_MS = 500;  

let authToken: string | null = null;
let accountId: string | null = null;

// --- REQUEST QUEUE (GATEKEEPER) ---
interface QueuedTask {
    execute: () => Promise<void>;
    resolve: (val: any) => void;
    reject: (err: any) => void;
}

const requestQueue: QueuedTask[] = [];
let isProcessingQueue = false;
let lastRequestTime = 0;

const processQueue = async () => {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    while (requestQueue.length > 0) {
        // 1. Throttle check
        const now = Date.now();
        const timeSinceLast = now - lastRequestTime;
        if (timeSinceLast < currentRequestIntervalMs) {
            await new Promise(resolve => setTimeout(resolve, currentRequestIntervalMs - timeSinceLast));
        }

        // 2. Circuit Breaker check
        if (isGlobalCooldown) {
            const waitTime = Math.max(0, globalCooldownResetTime - Date.now());
            if (waitTime > 0) {
                await new Promise(resolve => setTimeout(resolve, waitTime + 100));
                continue; // Re-check loop
            }
        }

        // 3. Execution
        const task = requestQueue.shift();
        if (task) {
            lastRequestTime = Date.now();
            try {
                await task.execute();
            } catch (e) {
                console.error("[Gatekeeper] Task failed critically:", e);
            }
        }
    }

    isProcessingQueue = false;
};

const enqueueFetch = <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise((resolve, reject) => {
        requestQueue.push({
            execute: async () => {
                try {
                    const result = await fn();
                    resolve(result);
                } catch (e) {
                    reject(e);
                }
            },
            resolve,
            reject
        });
        processQueue();
    });
};

const reportErrorToHtml = (msg: string) => {
    if (typeof window !== 'undefined' && window.titanReport) {
        window.titanReport(`[API ERROR] ${msg}`);
    }
    if (typeof document !== 'undefined') {
        const errEl = document.getElementById('splash-error');
        const controls = document.getElementById('splash-controls');
        if (errEl) {
            errEl.style.display = 'block';
            errEl.innerText = `API FAIL:\n${msg.substring(0, 200)}`;
        }
        if (controls) controls.style.display = 'block';
    }
};

export class TInvestApiError extends Error {
    constructor(
        public statusCode: number,
        public code: number, 
        public message: string, 
        public description: string, 
        public trackingId: string,
        public fullPayload: any
    ) {
        const safeMsg = (message || '').substring(0, 200);
        const safeDesc = (description || '').substring(0, 200);
        super(`[API ${statusCode}] ${safeMsg} ${safeDesc} (ID: ${trackingId})`);
        this.name = "TInvestApiError";
    }
}

/**
 * Determines if an error implies an unknown order state.
 * Returns TRUE for Network Errors, 502, 504 (Timeout).
 * Returns FALSE for Logic Errors (400, 422, Not Enough Funds).
 */
export const isAmbiguousError = (error: any): boolean => {
    const msg = (error.message || '').toLowerCase();
    
    // 1. Network Issues
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch')) return true;
    
    // 2. Server Timeouts / Gateways
    if (msg.includes('502') || msg.includes('503') || msg.includes('504')) return true;
    
    // 3. Client Timeouts (AbortController)
    if (error.name === 'AbortError') return true;

    // 4. API Business Logic Errors (Explicitly NOT ambiguous)
    // 400 (Bad Request), 401 (Auth), 404 (Not Found), 422 (Unprocessable)
    // Code 30042 = Not enough assets
    // Code 30079 = Instrument not trading
    if (error instanceof TInvestApiError) {
        // Status < 500 usually means the server processed it and said NO.
        if (error.statusCode < 500) return false;
    }

    if (msg.includes('not enough') || msg.includes('недостаточно')) return false;
    if (msg.includes('invalid') || msg.includes('неверн')) return false;

    // Default to ambiguous for safety if unsure
    return true; 
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const activateCooldown = (reason: string = "OVERLOAD", isCritical: boolean = false) => {
    if (!isGlobalCooldown) {
        const duration = isCritical ? COOLDOWN_CRITICAL_MS : COOLDOWN_TRANSIENT_MS;
        console.debug(`[TInvest API] 🛑 ${reason}. Circuit Breaker active for ${duration/1000}s.`);
        
        isGlobalCooldown = true;
        globalCooldownResetTime = Date.now() + duration;
        
        setTimeout(() => {
            isGlobalCooldown = false;
            processQueue(); 
        }, duration);
    }
};

export const makeApiRequest = async <T>(
    endpoint: string, 
    method: 'GET' | 'POST' = 'POST', 
    body: object = {}, 
    silent: boolean = false,
    noRetry: boolean = false,
    timeoutMs?: number // TITAN-IRONCLAD: Кастомный таймаут
): Promise<T> => {
    if (!authToken) {
        reportErrorToHtml("Token missing.");
        throw new Error('T-Invest API Token not set.');
    }

    let lastError: Error | null = null;
    const attemptsLimit = noRetry ? 1 : MAX_RETRIES;
    const effectiveTimeout = timeoutMs || REQUEST_TIMEOUT_MS;
    
    for (let attempt = 1; attempt <= attemptsLimit; attempt++) {
        if (isGlobalCooldown) {
             const wait = Math.max(500, globalCooldownResetTime - Date.now());
             await sleep(wait);
        }

        const targetUrl = `${API_BASE_URL}${endpoint}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

        try {
            const headers: HeadersInit = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
                'x-app-name': TINVEST_APP_NAME,
            };
            const config: RequestInit = {
                method,
                headers,
                body: method === 'POST' ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            };

            const response = await enqueueFetch(() => fetch(targetUrl, config));
            clearTimeout(timeoutId);

            if (response.status === 401) {
                activateCooldown("AUTH_INVALID", true);
                throw new Error("AUTH_ERROR: 401. Check API Key.");
            }

            if (!response.ok) {
                const status = response.status;
                
                // Enhanced Rate Limit & Server Error Handling
                if (status === 429) {
                    activateCooldown("RATE_LIMIT", true); 
                    throw new Error(`HTTP 429: Rate Limit Exceeded.`);
                }
                
                if (status >= 500) {
                    // 500 (Internal), 502 (Bad Gateway), 503 (Unavailable), 504 (Timeout)
                    const reason = status === 503 ? "SERVER_UNAVAILABLE" : "BAD_GATEWAY";
                    activateCooldown(reason, false); // Transient
                    throw new Error(`HTTP ${status}: Server Error (Transient).`);
                }

                try {
                    const errorData = await response.json();
                    const code = errorData.code || 0;
                    const message = errorData.message || 'No message';
                    const description = errorData.description || '';
                    const trackingId = response.headers.get('x-tracking-id') || 'unknown';
                    
                    if (code === 16) {
                        activateCooldown("AUTH_FAIL", true);
                        throw new Error(`AUTH ERROR: ${message}`);
                    }
                    if (code === 8) activateCooldown("RESOURCE_EXHAUSTED", true); 
                    
                    // Throw special error with payload so OrderController can check codes
                    throw new TInvestApiError(status, code, message, description, trackingId, errorData);

                } catch (e: any) {
                    if (e instanceof TInvestApiError) throw e;
                    const err = new Error(`HTTP Error! Status: ${status} (${response.statusText})`);
                    (err as any).status = status;
                    throw err;
                }
            }

            const responseText = await response.text();
            
            try {
                if (!responseText) return {} as T;
                return JSON.parse(responseText);
            } catch (parseError) {
                return {} as T;
            }

        } catch (error: any) {
            clearTimeout(timeoutId);
            lastError = error;
            
            const msg = (error.message || '').toLowerCase();
            const isAuthError = msg.includes('auth') || msg.includes('access_denied');
            
            if (noRetry || isAuthError) {
                throw error; 
            }
            
            // Don't retry on Business Errors (e.g. Insufficient funds), only Network errors
            if (error instanceof TInvestApiError) {
                throw error; // Business logic failure is final for this attempt
            }
            
            if (attempt === attemptsLimit) {
                throw error;
            }
            
            const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
            await sleep(delay);
        }
    }
    
    if (lastError) throw lastError;
    throw new Error(`API request to '${endpoint}' failed inexplicably.`);
};

export const setAuthToken = (token: string) => {
    authToken = token;
    accountId = null; 
};

export const getAuthToken = () => authToken;

export const getServerTime = async (): Promise<Date> => {
    if (!authToken) throw new Error('T-Invest API Token not set.');
    try {
        await makeApiRequest<any>('tinkoff.public.invest.api.contract.v1.UsersService/GetAccounts', 'POST', {}, true, true);
        return new Date(); 
    } catch (e) {
        return new Date();
    }
};

export const getAccountId = async (forceRefresh: boolean = false): Promise<string> => {
    if (accountId && !forceRefresh) return accountId;
    const { accounts } = await makeApiRequest<ApiGetAccountsResponse>('tinkoff.public.invest.api.contract.v1.UsersService/GetAccounts', 'POST', {});
    
    if (!accounts || accounts.length === 0) {
        throw new Error('No accounts returned from API.');
    }

    console.log('[TInvest API] Available Accounts:', accounts.map(a => `${a.id} | ${a.name} | ${a.type} | ${a.status}`));

    const openAccounts = accounts.filter(acc => acc.status === 'ACCOUNT_STATUS_OPEN');
    if (openAccounts.length === 0) {
        accountId = accounts[0].id;
        return accountId || '';
    }

    // AUTO-DISCOVERY: Find the account with actual funds
    for (const acc of openAccounts) {
        try {
            // Check portfolio for funds using a direct low-level API call to avoid circular dependency
            const portfolio = await makeApiRequest<any>('tinkoff.public.invest.api.contract.v1.OperationsService/GetPortfolio', 'POST', { accountId: acc.id });
            const totalAmount = portfolio.totalAmountPortfolio;
            
            let val = 0;
            if (totalAmount) {
                const units = typeof totalAmount.units === 'string' ? parseInt(totalAmount.units, 10) : (totalAmount.units || 0);
                const nano = totalAmount.nano || 0;
                val = units + nano / 1000000000;
            }

            if (val <= 0) {
                // Also check if positions exist
                if (portfolio.positions && portfolio.positions.length > 0) {
                    console.log(`[TInvest API] Account ${acc.id} (${acc.name}) has positions but 0 totalAmount. Selecting it.`);
                    accountId = acc.id;
                    return accountId || '';
                }
            } else {
                console.log(`[TInvest API] Account ${acc.id} (${acc.name}) has funds: ${val}. Selecting it.`);
                accountId = acc.id;
                return accountId || '';
            }
        } catch (e: any) {
            console.log(`[TInvest API] Failed to check portfolio for account ${acc.id} (${acc.name}): ${e.message}`);
        }
    }

    // Default fallback if no accounts have funds
    const targetAccount = openAccounts.find(acc => acc.type === 'ACCOUNT_TYPE_TINKOFF') || openAccounts[0];
    
    console.log('[TInvest API] Selected Default Account ID:', targetAccount.id);
    accountId = targetAccount.id;
    return accountId || '';
};
