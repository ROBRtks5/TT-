
/**
 * TITAN TRADING BOT - STREAM MANAGER (LAZARUS PROTOCOL)
 * ---------------------------------------------------------
 * @module services/streamManager.ts
 * @version 18.5.0 (SMART WATCHDOG)
 * ---------------------------------------------------------
 */

import { CandleInterval, ChartDataPoint, OrderBook, LastTrade, LogType } from '../types';

export type StreamStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'ERROR';

export interface StreamSubscription {
    id: string;
    type: 'CANDLE' | 'ORDERBOOK' | 'PORTFOLIO' | 'TRADES';
    figi: string;
    interval?: CandleInterval;
}
import { MAX_STREAM_STRIKES, PULSE_TIMEOUT_MS, DATA_STALE_TIMEOUT_MS } from '../constants';
import * as tInvestService from './tInvestService';
import { isMarketOpenNow, getServerTimeNow } from '../utils/marketTime';

type StreamEventType = 'candle' | 'orderbook' | 'status' | 'error' | 'portfolio' | 'trades' | 'log' | 'reconnected' | 'orders';
type StreamCallback = (data: any) => void;

// STABILITY CONFIG
const RECONNECT_BASE_DELAY = 1000; 
const RECONNECT_MAX_DELAY = 30000; // Increased to 30s for better resilience against API bans
const POLL_INTERVAL_FAST_MS = 3000; 
const POLL_INTERVAL_SLOW_MS = 30000; 
const WATCHDOG_THRESHOLD_MS = 30000; // Tightened from 90s to 30s for HFT-like safety

// Micro-delay between serial requests to prevent clustering
const SERIAL_DELAY_MS = 150; 

export class StreamManager {
    private status: StreamStatus = 'DISCONNECTED';
    private subscriptions: Map<string, StreamSubscription> = new Map();
    private listeners: Map<StreamEventType, StreamCallback[]> = new Map();
    
    private fastPollTimer: any = null;
    private slowPollTimer: any = null;
    private watchdogTimer: any = null;
    private reconnectTimer: any = null;
    
    private reconnectAttempts = 0;
    
    // HEARTBEAT SYSI
    private lastPulseTimestamp = 0;
    private lastDataTimestamp = 0;
    private lastCandleTimestamp = 0;
    
    private lastConnectAttempt = 0; 
    private consecutiveFastErrors = 0;
    private consecutiveSlowErrors = 0;

    private lastCandleSignatures: Map<string, string> = new Map();

    constructor() {
        this.resetListeners();
        this.setupNetworkListeners();
    }

    private setupNetworkListeners() {
        const globalScope = typeof window !== 'undefined' ? window : self;
        
        if (globalScope.addEventListener) {
            globalScope.addEventListener('online', () => {
                this._log(LogType.INFO, "🌐 СЕТЬ: Подключение обнаружено. Инициация восстановления...");
                // Immediate reaction without waiting for poll loop
                this.reconnect();
            });
            
            globalScope.addEventListener('offline', () => {
                this._log(LogType.WARNING, "🔌 СЕТЬ: Разрыв соединения (OS Event).");
                this.disconnect();
            });
        }
    }

    public isConnectionAlive(): boolean {
        return this.status === 'CONNECTED';
    }

    public getDiagnostics() {
        const now = getServerTimeNow();
        return {
            status: this.status,
            subscriptionsCount: this.subscriptions.size,
            pulseAgeMs: now - this.lastPulseTimestamp,
            dataAgeMs: now - this.lastDataTimestamp,
            candleAgeMs: now - this.lastCandleTimestamp,
            reconnectAttempts: this.reconnectAttempts,
            fastStrikes: this.consecutiveFastErrors,
            slowStrikes: this.consecutiveSlowErrors
        };
    }

    public resetListeners() {
        this.listeners = new Map();
        this.listeners.set('candle', []);
        this.listeners.set('orderbook', []);
        this.listeners.set('status', []);
        this.listeners.set('error', []);
        this.listeners.set('portfolio', []);
        this.listeners.set('trades', []);
        this.listeners.set('log', []);
        this.listeners.set('reconnected', []);
        this.listeners.set('orders', []); // New channel
    }

    public async connect(): Promise<void> {
        const now = getServerTimeNow();
        
        // ZOMBIE CHECK
        if (this.status === 'CONNECTING') {
            if (now - this.lastConnectAttempt > 15000) { 
                this._log(LogType.WARNING, "⚡ LAZARUS: Зависание подключения. Сброс.");
                this.disconnect(); 
            } else {
                return; 
            }
        }
        
        if (this.status === 'CONNECTED') {
            this._emit('status', 'CONNECTED');
            return;
        }
        
        this.lastConnectAttempt = now;
        this._setStatus('CONNECTING');
        
        try {
            await tInvestService.getAccount(); 
            
            if (this.status === 'DISCONNECTED') {
                return; // User cancelled
            }

            const isReconnection = this.reconnectAttempts > 0;
            this._setStatus('CONNECTED');
            this.reconnectAttempts = 0;
            this.consecutiveFastErrors = 0; 
            this.consecutiveSlowErrors = 0;
            
            const syncNow = getServerTimeNow();
            this.lastPulseTimestamp = syncNow;
            this.lastDataTimestamp = syncNow;
            this.lastCandleTimestamp = syncNow; 
            this.lastCandleSignatures.clear(); 
            
            this._startLoops();
            this._startWatchdog();
            
            if (isReconnection) {
                this._log(LogType.SUCCESS, "♻️ Поток: Связь восстановлена (Stable Mode).");
                this._emit('reconnected', {});
            } else {
                this._log(LogType.SYSTEM, "✅ Поток: Соединение установлено.");
            }
            
        } catch (e: any) {
            if (this.status === 'DISCONNECTED') return;
            
            const msg = (e.message || '').toLowerCase();
            let friendlyError = `Ошибка: ${e.message}`;
            
            if (msg.includes('auth') || msg.includes('401') || msg.includes('403')) {
                friendlyError = "⛔ Ошибка доступа (Проверьте API токен)";
            } else if (msg.includes('failed to fetch') || msg.includes('network')) {
                friendlyError = "🔌 Ошибка сети (Интернет/Блокировка)";
            }

            this._log(LogType.ERROR, friendlyError);
            this._handleConnectionLoss();
        }
    }

    public disconnect(): void {
        this._stopLoops();
        this._stopWatchdog();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this._setStatus('DISCONNECTED');
    }

    public reconnect(): void {
        this._log(LogType.WARNING, "🔄 Поток: Принудительная реанимация...");
        this.disconnect();
        setTimeout(() => this.connect(), 100);
    }

    public forceRefresh(): void {
        if (this.status !== 'CONNECTED') {
            this.connect();
            return;
        }
        this._stopLoops();
        this._runFastLoop();
        this._runSlowLoop();
    }

    public clearSubscriptions(): void {
        this.subscriptions.clear();
        this.lastCandleSignatures.clear();
    }

    public subscribeCandles(figi: string, interval: CandleInterval): void {
        const id = `candle:${figi}:${interval}`;
        if (!this.subscriptions.has(id)) this.subscriptions.set(id, { id, type: 'CANDLE', figi, interval });
    }

    public subscribeOrderBook(figi: string): void {
        const id = `ob:${figi}`;
        if (!this.subscriptions.has(id)) this.subscriptions.set(id, { id, type: 'ORDERBOOK', figi });
    }

    public subscribeTrades(figi: string): void {
        const id = `trades:${figi}`;
        if (!this.subscriptions.has(id)) this.subscriptions.set(id, { id, type: 'TRADES', figi });
    }

    public subscribePortfolio(figi: string): void {
        const id = `portfolio:${figi}`;
        if (!this.subscriptions.has(id)) this.subscriptions.set(id, { id, type: 'PORTFOLIO', figi });
    }

    public on(event: StreamEventType, callback: StreamCallback): void {
        if (!this.listeners.has(event)) this.listeners.set(event, []);
        this.listeners.get(event)!.push(callback);
    }

    public off(event: StreamEventType, callback: StreamCallback): void {
        if (!this.listeners.has(event)) return;
        const callbacks = this.listeners.get(event)!;
        const index = callbacks.indexOf(callback);
        if (index > -1) {
            callbacks.splice(index, 1);
        }
    }

    private _log(type: LogType, message: string) {
        this._emit('log', { type, message });
    }

    private _setStatus(newStatus: StreamStatus): void {
        if (this.status !== newStatus) {
            this.status = newStatus;
            this._emit('status', newStatus);
        }
    }

    private _emit(event: StreamEventType, data: any): void {
        (this.listeners.get(event) || []).forEach(cb => { try { cb(data); } catch (e) {} });
    }

    private _startLoops(): void {
        this._stopLoops();
        this._runFastLoop();
        this._runSlowLoop();
    }

    private _stopLoops(): void {
        if (this.fastPollTimer) clearTimeout(this.fastPollTimer);
        if (this.slowPollTimer) clearTimeout(this.slowPollTimer);
        this.fastPollTimer = null;
        this.slowPollTimer = null;
    }

    private _runFastLoop(): void {
        const loop = async () => {
            if (this.status !== 'CONNECTED') return;
            try {
                const now = getServerTimeNow();
                const fastSubs = Array.from(this.subscriptions.values()).filter(s => s.type !== 'PORTFOLIO');
                
                let successfulNetworkCall = false;
                let gotCandle = false;

                // SERIAL EXECUTION with Spacing (Throttling)
                for (const sub of fastSubs) {
                    if (this.status !== 'CONNECTED') break;

                    try {
                        if (sub.type === 'CANDLE' && sub.figi) {
                            const candles = await tInvestService.fetchCandles({ figi: sub.figi } as any, sub.interval!, new Date(now - 120*60000), new Date(now));
                            successfulNetworkCall = true;

                            if (candles.length > 0) {
                                gotCandle = true;
                                const last = candles[candles.length - 1];
                                const signature = `${last.time}_${last.price}_${last.volume}`;
                                const lastSig = this.lastCandleSignatures.get(sub.id);

                                if (signature !== lastSig) {
                                    this.lastCandleSignatures.set(sub.id, signature);
                                    this._emit('candle', { 
                                        interval: sub.interval, 
                                        candle: last, 
                                        all: candles,
                                        figi: sub.figi 
                                    });
                                }
                            }
                        } else if (sub.type === 'ORDERBOOK' && sub.figi) {
                            const ob = await tInvestService.getOrderBook(sub.figi);
                            successfulNetworkCall = true; 
                            if (ob) this._emit('orderbook', ob);
                        } else if (sub.type === 'TRADES' && sub.figi) {
                            const trades = await tInvestService.getLastTrades(sub.figi, new Date(now - 5*60000), new Date(now));
                            successfulNetworkCall = true; 
                            if (trades.length > 0) {
                                this._emit('trades', { figi: sub.figi, trades: trades.slice(0, 50) });
                            }
                        }
                    } catch (e: any) {
                        const msg = e.message || '';
                        // Don't count transient errors as total failure of the loop
                        if (msg.includes('AUTH_ERROR')) throw e;
                    }

                    // SPACING: Wait before next request
                    await new Promise(resolve => setTimeout(resolve, SERIAL_DELAY_MS));
                }
                
                // Keep-Alive for Candle Subs if no trades received
                const hasCandleSub = fastSubs.some(s => s.type === 'CANDLE');
                if (hasCandleSub && !successfulNetworkCall) {
                     // Try a lightweight heartbeat check if main loop was empty/failed
                     try {
                         await tInvestService.getServerTime(); // Just a ping
                         successfulNetworkCall = true;
                     } catch(e) {}
                }
                
                const finalNow = getServerTimeNow();
                if (successfulNetworkCall) {
                    this.lastPulseTimestamp = finalNow;
                    this.consecutiveFastErrors = 0;
                } else {
                    this.consecutiveFastErrors++;
                }
                
                if (gotCandle) this.lastCandleTimestamp = finalNow;

            } catch (e: any) {
                if (e.message?.includes('AUTH_ERROR')) {
                    this.disconnect();
                    this._emit('error', 'AUTH_ERROR');
                    return; 
                }
                
                this.consecutiveFastErrors++;
                if (this.consecutiveFastErrors >= 7) { 
                    this._log(LogType.WARNING, `📡 Stream: Слишком много ошибок (${this.consecutiveFastErrors}). Перезагрузка.`);
                    this._handleConnectionLoss();
                    return; 
                }
            }

            // JITTER: Add randomness to polling interval to avoid resonance
            const jitter = Math.floor(Math.random() * 500); // 0-500ms
            this.fastPollTimer = setTimeout(loop, POLL_INTERVAL_FAST_MS + jitter);
        };
        loop();
    }

    private _runSlowLoop(): void {
        const loop = async () => {
            if (this.status !== 'CONNECTED') return;
            try {
                const slowSubs = Array.from(this.subscriptions.values()).filter(s => s.type === 'PORTFOLIO');
                
                // Also serial execution for portfolio
                for (const sub of slowSubs) {
                    try {
                        if (sub.type === 'PORTFOLIO' && sub.figi) {
                            // 1. FETCH ACCOUNT DATA
                            const account = await tInvestService.getAccount();
                            const [margin, pos] = await Promise.all([
                                tInvestService.getMarginAttributes(account),
                                tInvestService.getPosition(sub.figi!)
                            ]);
                            this._emit('portfolio', { account, margin, position: pos });
                            
                            // 2. FETCH ACTIVE ORDERS (OMNI-VISION PATCH)
                            // We explicitly poll active orders here so the bot isn't blind to external cancellations
                            const orders = await tInvestService.getActiveOrders(sub.figi!);
                            this._emit('orders', orders);
                        }
                    } catch (e) {}
                    await new Promise(resolve => setTimeout(resolve, SERIAL_DELAY_MS));
                }
                this.consecutiveSlowErrors = 0;
            } catch (e) {
                this.consecutiveSlowErrors++;
            }
            
            // Jitter for slow loop
            const jitter = Math.floor(Math.random() * 2000); 
            this.slowPollTimer = setTimeout(loop, POLL_INTERVAL_SLOW_MS + jitter);
        };
        loop();
    }

    private _startWatchdog(): void {
        if (this.watchdogTimer) clearInterval(this.watchdogTimer);
        this.watchdogTimer = setInterval(() => {
            if (this.status === 'CONNECTED') {
                // PHASE 9.2: SMART WATCHDOG
                // Only bark if market is ostensibly open. If closed, data silence is expected.
                if (!isMarketOpenNow()) {
                    return;
                }

                const now = getServerTimeNow();
                const pulseSilence = now - this.lastPulseTimestamp;
                
                // Watchdog threshold reduced to 30s for higher responsiveness
                if (pulseSilence > WATCHDOG_THRESHOLD_MS) { 
                    this._log(LogType.WARNING, `🐕 Watchdog: ПУЛЬС ПРОПАЛ (${(pulseSilence/1000).toFixed(0)}с). Переподключение.`);
                    this._handleConnectionLoss();
                    return;
                }
            }
        }, 5000); // Checked more frequently (5s)
    }

    private _stopWatchdog(): void {
        if (this.watchdogTimer) clearInterval(this.watchdogTimer);
        this.watchdogTimer = null;
    }

    private _handleConnectionLoss(): void {
        this._stopLoops(); 
        this._setStatus('RECONNECTING');
        this.reconnectAttempts++;
        
        // TITAN-IRONCLAD-3.3: Exponential Backoff (2^n * base) + Jitter
        const jitter = Math.floor(Math.random() * 1000);
        const exponentialDelay = Math.pow(2, Math.min(this.reconnectAttempts - 1, 5)) * RECONNECT_BASE_DELAY;
        const delay = Math.min(exponentialDelay + jitter, RECONNECT_MAX_DELAY);
        
        this._log(LogType.WARNING, `📡 Stream: Потеря связи. Попытка #${this.reconnectAttempts} через ${(delay/1000).toFixed(1)}с...`);
        
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => { this.connect(); }, delay);
    }
}

export const streamManager = new StreamManager();
