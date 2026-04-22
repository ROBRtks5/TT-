
import { BotKernel } from '../bot-kernel';
import { LogType, TradeDirection, GridOrder } from '../../types';
import * as tInvestService from '../../services/tInvestService';
import { isAmbiguousError } from '../../services/tInvestApi'; 
import * as debugService from '../../services/debugService';
import * as capitalService from '../../services/capitalService';
import { getServerTimeNow } from '../../utils/marketTime';
import { areEqual, roundPriceToTick } from '../../utils/math'; 
import { AMM_CONFIG, BROKER_FEE_PERCENT } from '../../constants';
import { calculateATR, calculateAdaptiveTTechGrid, calculateAPZ, calculateNATR, calculateDonchianChannels } from '../../services/mathStrategyService';
import { tradeStreamService } from '../../services/tradeStreamService';

const EXECUTION_COOLDOWN_MS = 3000; 
const DATA_STALE_THRESHOLD_MS = 30000; 

export class OrderController {
    private isExecutionInProgress = false;
    private inFlightOrders: Set<string> = new Set(); // Защита от дублей
    private pendingExecutionIds: Set<string> = new Set();
    private logThrottles = new Map<string, number>();
    private lastActionTime = 0; 
    private lastGridPrice = 0;
    private currentRegime: 'TREND_UP' | 'TREND_DOWN' | 'FLAT' = 'FLAT';
    private adaptiveBasePrice: number = 0;

    constructor(private kernel: BotKernel) {}

    private isBotRunning(): boolean {
        return this.kernel.getState().isBotActive;
    }

    private shouldLog(key: string, cooldownMs: number): boolean {
        const now = Date.now();
        const last = this.logThrottles.get(key) || 0;
        if (now - last > cooldownMs) {
            this.logThrottles.set(key, now);
            return true;
        }
        return false;
    }

    public async handleOrderFill(event: import('../../services/tradeStreamService').OrderFillEvent) {
        if (!this.isBotRunning() || this.isExecutionInProgress) return;
        this.isExecutionInProgress = true;

        try {
            this.kernel.log(LogType.SUCCESS, `⚡ ИСПОЛНЕНИЕ: ${event.direction} ${event.quantity} шт. @ ${event.price.toFixed(2)}`);

            this.kernel.updateState(prev => {
                const pos = prev.position;
                let newQty = pos ? pos.currentQuantity : 0;
                let newEntryPrice = pos ? pos.entryPrice : 0;

                if (event.direction === TradeDirection.BUY || (event.direction as any) === 'ORDER_DIRECTION_BUY') {
                    const totalCost = (newQty * newEntryPrice) + (event.quantity * event.price);
                    newQty += event.quantity;
                    newEntryPrice = newQty > 0 ? totalCost / newQty : 0;
                } else if (event.direction === TradeDirection.SELL || (event.direction as any) === 'ORDER_DIRECTION_SELL') {
                    newQty -= event.quantity;
                    if (newQty <= 0) {
                        newQty = 0;
                        newEntryPrice = 0;
                    }
                }

                const effectivePower = prev.effectiveBuyingPower || 0;
                const cost = event.quantity * event.price * (prev.instrumentDetails?.lot || 1);
                const newPower = event.direction === TradeDirection.BUY || (event.direction as any) === 'ORDER_DIRECTION_BUY'
                    ? Math.max(0, effectivePower - cost)
                    : effectivePower + cost;

                const newTrade: import('../../types').TradeHistoryEntry = {
                    id: event.orderId + '-' + Date.now(),
                    type: 'TRADE',
                    pnl: 0,
                    outcome: 'Neutral',
                    decisionReason: 'Stream Fill',
                    exitTime: Date.now(),
                    entryPrice: event.price,
                    exitPrice: event.price,
                    quantity: event.quantity,
                    volume: event.quantity * event.price
                };

                return {
                    position: pos ? { ...pos, currentQuantity: newQty, entryPrice: newEntryPrice } : undefined,
                    effectiveBuyingPower: newPower,
                    tradeHistory: [newTrade, ...(prev.tradeHistory || [])].slice(0, 500),
                    activeGridOrders: (prev.activeGridOrders || []).filter(o => o.orderId !== event.orderId)
                };
            }, false);

            this.isExecutionInProgress = false; 
            
            await this.processAdaptiveTTech(true);

        } catch (e: any) {
            this.kernel.log(LogType.ERROR, `Ошибка перестроения: ${e.message}`);
            this.isExecutionInProgress = false;
        }
    }

    public async syncAMMGrid(virtualOrders: import('../../types').VirtualOrder[], activeOrders: GridOrder[], figi: string) {
        if (!this.isBotRunning() || this.isExecutionInProgress) return;
        
        const state = this.kernel.getState();
        const currentPrice = state.lastTrades && state.lastTrades[0] ? state.lastTrades[0].price : 0;
        const delta = Math.abs(currentPrice - this.lastGridPrice) / (currentPrice || 1);
        
        if (activeOrders.length > 0 && delta < 0.001) {
            return;
        }

        this.isExecutionInProgress = true;
        this.lastGridPrice = currentPrice;

        try {
            const tickSize = state.instrumentDetails?.minPriceIncrement || 0.01;
            const ordersToCancel: GridOrder[] = [];
            const matchedVirtualIndices = new Set<number>();

            for (const active of activeOrders) {
                // TITAN-LOCK: Не трогаем ордера, которые мы только что отправили и они еще PENDING (нет API ID)
                if (active.orderId.startsWith('optimistic-') || active.status === 'PENDING') {
                    // Имитируем match, чтобы не отменять
                    continue;
                }

                const matchIndex = virtualOrders.findIndex((v, idx) => 
                    !matchedVirtualIndices.has(idx) &&
                    v.direction === active.direction &&
                    areEqual(v.price, active.price, tickSize) && // СТРОГОЕ СРАВНЕНИЕ (tickSize)
                    Math.abs(v.volume - active.qty) === 0
                );

                if (matchIndex !== -1) {
                    matchedVirtualIndices.add(matchIndex);
                } else {
                    ordersToCancel.push(active);
                }
            }

            const ordersToPlace = virtualOrders.filter((_, idx) => !matchedVirtualIndices.has(idx));

            for (const order of ordersToCancel) {
                if (!this.isBotRunning()) break; // STOP-CHECK
                this.kernel.log(LogType.INFO, `🧹 AMM: Снятие ордера ${order.direction} ${order.qty} @ ${order.price.toFixed(2)}`);
                try {
                    await tInvestService.cancelOrder(order.orderId);
                    
                    this.kernel.updateState((prev) => ({
                        activeGridOrders: (prev.activeGridOrders || []).filter(o => o.orderId !== order.orderId)
                    }), false);
                    
                    await new Promise(r => setTimeout(r, 250)); 
                } catch (e: any) {
                    this.kernel.log(LogType.WARNING, `⚠️ Ошибка снятия ордера ${order.orderId}: ${e.message}`);
                }
            }

            for (const vOrder of ordersToPlace) {
                if (!this.isBotRunning()) break; // STOP-CHECK
                if (vOrder.volume <= 0) continue;

                // LOCK: Prevent duplicates
                const lockKey = `${vOrder.direction}-${vOrder.price.toFixed(2)}`;
                if (this.inFlightOrders.has(lockKey)) continue;

                this.inFlightOrders.add(lockKey);
                this.kernel.log(LogType.INFO, `🎯 AMM: Выставление ${vOrder.direction} ${vOrder.volume} @ ${vOrder.price.toFixed(2)}`);
                try {
                    await this.executeOrder(figi, vOrder.volume, vOrder.direction, vOrder.price, vOrder.metadata);
                    await new Promise(r => setTimeout(r, 333)); 
                } catch (e: any) {
                    const msg = (e.message || '').toLowerCase();
                    if (msg.includes("not enough") || msg.includes("недостаточно") || msg.includes("429") || msg.includes("limit") || msg.includes("auth")) {
                        this.inFlightOrders.delete(lockKey);
                        break;
                    }
                } finally {
                    this.inFlightOrders.delete(lockKey); // Release lock
                }
            }

        } catch (e: any) {
            this.kernel.log(LogType.ERROR, `AMM Sync Error: ${e.message}`);
        } finally {
            this.isExecutionInProgress = false;
        }
    }

    public async processAdaptiveTTech(force: boolean = false) {
        if (this.isExecutionInProgress) return;

        const timeSinceLastAction = Date.now() - this.lastActionTime;
        if (!force && timeSinceLastAction < EXECUTION_COOLDOWN_MS) {
            return; 
        }

        try {
            const state = this.kernel.getState();
            const { 
                instrumentDetails, ammCapitalState, position, lastTrades, chartData
            } = state;

            // SAFETY GORIZONT: Валидация входных данных
            if (!instrumentDetails || !ammCapitalState) return;
            
            // Защита от мусорных данных (NaN/Zero capital)
            if (!Number.isFinite(ammCapitalState.totalCapitalValue) || ammCapitalState.totalCapitalValue <= 0) {
                if (this.shouldLog('err_capital', 60000)) {
                    this.kernel.log(LogType.WARNING, "⚠️ TITAN-LOGIC: Ожидание валидных данных о капитале...");
                }
                return;
            }

            let currentPrice = 0;
            if (lastTrades && lastTrades.length > 0) {
                currentPrice = lastTrades[0].price;
            } else if (chartData['1m'] && chartData['1m'].length > 0) {
                currentPrice = chartData['1m'][chartData['1m'].length - 1].price;
            }

            if (currentPrice <= 0) return;

            const realQty = position ? position.currentQuantity : 0;
            const avgPrice = position?.entryPrice || 0;
            
            // Защита от старта без позиции (чтобы не генерировать только BUY-сетку, если мы на самом деле в позиции)
            if (this.shouldLog('wait_pos', 5000) && position === null) {
                this.kernel.log(LogType.INFO, "⚠️ T-TECH: Ожидание полной синхронизации позиции (генерация сетки приостановлена)...");
            }
            if (position === null) return; 

            // 1. ПРОАКТИВНЫЙ ВХОД (30%) - Остается без изменений (классика TITAN)
            if (realQty === 0) {
                // Защита от дубликатов: проверяем, нет ли уже "летящего" ордера на покупку
                const pendingBuys = (state.activeGridOrders || []).filter(o => o.direction === TradeDirection.BUY && o.status === 'PENDING').length;
                if (pendingBuys > 0) {
                    if (this.shouldLog('wait_entry', 30000)) {
                        this.kernel.log(LogType.INFO, `⏳ T-TECH: Ожидание исполнения проактивного входа (Ордеров в пути: ${pendingBuys})...`);
                    }
                    return; 
                }

                this.kernel.log(LogType.INFO, `🎯 T-TECH: Проактивный вход (30%)...`);
                this.isExecutionInProgress = true;
                
                const lotSize = instrumentDetails.lot || 1;
                // БЕРЕМ СТРОГО ОТ СВОБОДНОГО КЭША! Иначе маржинальный отказ
                // Так как это проактивный вход, выделим 30% от того, что доступно
                const buyAmount = (state.effectiveBuyingPower || 0) * 0.3; 
                
                if (currentPrice > 0 && buyAmount > 0) {
                    const lotsToBuy = Math.floor(buyAmount / (currentPrice * lotSize));
                    
                    if (lotsToBuy > 0) {
                        try {
                            // ИСПОЛЬЗОВАТЬ ЛИМИТНЫЙ ОРДЕР по currentPrice, НЕ МАРКЕТ С ЦЕНОЙ 0!
                            // Добавим пару тиков наверх, чтобы сработало наверняка как маркет
                            const tickSize = instrumentDetails.minPriceIncrement || 0.01;
                            const safeLimitPrice = currentPrice + (tickSize * 2);

                            await this.executeOrder(instrumentDetails.figi, lotsToBuy, TradeDirection.BUY, safeLimitPrice, { reason: 'PROACTIVE_ENTRY_30' });
                            this.kernel.log(LogType.SUCCESS, `✅ T-TECH: Вход исполнен через безопасный лимит!`);
                            this.adaptiveBasePrice = currentPrice; // Инициализация базы
                        } catch (ordersError: unknown) {
                            this.kernel.log(LogType.ERROR, `Ошибка при входе: ${(ordersError as Error).message}`);
                        }
                    } else {
                         this.kernel.log(LogType.WARNING, `⚠️ Не хватает кэша для проактивного входа (Доступно: ${state.effectiveBuyingPower}, Требуется: ${currentPrice * lotSize})`);
                    }
                }
                this.isExecutionInProgress = false;
                return; 
            }

            // --- T-TECH ФАЗА 3: РАСЧЕТ ИНДИКАТОРОВ И РЕЖИМА ---
            const dailyCandles = chartData['1m'] || []; // Используем 1m свечи для адаптации в реал-тайме
            if (dailyCandles.length < 65) { // Нужно минимум 64 свечи для nATR (atr14 + sma50)
                if (this.shouldLog('err_candles', 60000)) {
                    this.kernel.log(LogType.WARNING, `⚠️ T-TECH: Ожидание накопления свечей (доступно: ${dailyCandles.length}/65).`);
                }
                return; 
            }

            const apz = calculateAPZ(dailyCandles, 20);
            const nATR = calculateNATR(dailyCandles, 14, 50);
            const donchian = calculateDonchianChannels(dailyCandles, 20);

            // Инициализация при старте (если скрипт перезапущен)
            if (this.adaptiveBasePrice === 0) {
                this.adaptiveBasePrice = currentPrice;
            }

            // Анализ тренда (по закрытым свечам). 
            // Последняя свеча формируется, берем предпоследнюю и пред-предпоследнюю.
            const closed1 = dailyCandles[dailyCandles.length - 2];
            const closed2 = dailyCandles[dailyCandles.length - 3];

            if (closed1 && closed2) {
                if (closed1.price > donchian.upper && closed2.price > donchian.upper) {
                    if (this.currentRegime !== 'TREND_UP') {
                        this.kernel.log(LogType.WARNING, `🚀 T-TECH: Смена режима -> TREND_UP. Смещаем центр вверх!`);
                        this.currentRegime = 'TREND_UP';
                        this.adaptiveBasePrice = currentPrice; 
                    }
                } else if (closed1.price < donchian.lower && closed2.price < donchian.lower) {
                    if (this.currentRegime !== 'TREND_DOWN') {
                        this.kernel.log(LogType.WARNING, `🩸 T-TECH: Смена режима -> TREND_DOWN. Смещаем центр вниз!`);
                        this.currentRegime = 'TREND_DOWN';
                        this.adaptiveBasePrice = currentPrice;
                    }
                } else {
                    if (this.currentRegime !== 'FLAT') {
                        this.kernel.log(LogType.INFO, `⚖️ T-TECH: Смена режима -> FLAT (Боковик).`);
                        this.currentRegime = 'FLAT';
                    }
                }
            }

            // Защита от фликеринга: пересчитываем только если цена отошла (или тренд заставил сменить базу)
            // Но также форсируем пересчет если у нас пустая сетка или передан параметр force
            const priceDelta = Math.abs(currentPrice - (this.lastGridPrice || 0));
            const hasActiveOrders = (state.activeGridOrders && state.activeGridOrders.length > 0);
            
            // Если мы уже ставили сетку (lastGridPrice), и цена отклонилась меньше чем на 0.3%, 
            // и сетка жива (имеет ордера), и это не принудительный форс — пропускаем тик.
            if (!force && this.lastGridPrice && priceDelta < (currentPrice * 0.003) && hasActiveOrders) {
                return; 
            }
            this.lastGridPrice = currentPrice;

            // --- T-TECH ФАЗА 2: ГЕНЕРАЦИЯ АДАПТИВНОЙ СЕТКИ ---
            const availableCash = state.effectiveBuyingPower; // Весь доступный кэш идет в сетку
            
            const virtualOrders = calculateAdaptiveTTechGrid(
                this.adaptiveBasePrice,
                avgPrice,
                realQty,
                availableCash,
                instrumentDetails,
                apz,
                nATR
            );

            // Синхронизация с реальным рынком (Buy + Sell)
            await this.syncAMMGrid(virtualOrders, state.activeGridOrders || [], instrumentDetails.figi);
            
            this.kernel.log(LogType.INFO, `🧬 T-TECH: Сетка адаптирована. Шаг.nATR: ${nATR.toFixed(2)}, Режим: ${this.currentRegime}`);
        } catch (e: any) {
            this.lastActionTime = Date.now(); 
            this.kernel.log(LogType.ERROR, `T-TECH Logic Error: ${e.message}`);
        }
    }

    public async executeOrder(
        figi: string, 
        lots: number, 
        direction: TradeDirection, 
        limitPrice?: number, 
        metadata?: GridOrder['metadata']
    ) {
        if (lots <= 0) return;
        
        let finalPrice = limitPrice || 0;

        // --- TICK ALIGNMENT (CRITICAL) ---
        const state = this.kernel.getState();
        const tickSize = state.instrumentDetails?.minPriceIncrement || 0.01;
        
        if (finalPrice > 0) {
            finalPrice = roundPriceToTick(finalPrice, tickSize);
        }

        // --- CASH CHECK (OPTIMIZED: Use State) ---
        if (direction === TradeDirection.BUY) {
            try {
                // TITAN-IRONCLAD-3.1: Do not call getAccount on every order to save API limits.
                // We rely on the state updated by DataController and parent sync logic.
                const power = state.effectiveBuyingPower || 0;
                const lotSize = state.instrumentDetails?.lot || 1;
                const estimatedCost = finalPrice * lots * lotSize;
                
                if (estimatedCost > (power * 1.05)) { // 5% buffer
                    const msg = `⚠️ УПРАВЛЕНИЕ РИСКАМИ: Ордер ${lots} лотов @ ${finalPrice} (Cost: ${estimatedCost.toFixed(0)}) может превысить бюджет (${power.toFixed(0)}).`;
                    this.kernel.log(LogType.WARNING, msg);
                }
            } catch (e) {
                console.warn("Cash check failed, caution:", e);
            }
        }

        const tempId = `optimistic-${Date.now()}`;
        const optimisticOrder: GridOrder = {
            orderId: tempId,
            status: 'PENDING',
            qty: lots,
            price: finalPrice,
            direction: direction,
            createdAt: Date.now(),
            metadata: metadata
        };
        
        this.pendingExecutionIds.add(tempId);
        
        // TITAN-IRONCLAD: Safe Atomic Placement
        this.kernel.updateState((prev) => ({
            activeGridOrders: [...(prev.activeGridOrders || []), optimisticOrder]
        }), false);

        try {
            debugService.logTrace('ExecuteOrder', 'SENDING', { figi, lots, direction, price: finalPrice });

            let apiOrderId: string;
            
            if (direction === TradeDirection.SELL) {
                if (finalPrice > 0) {
                    apiOrderId = await tInvestService.placeOrder(figi, lots, direction, 'LIMIT', finalPrice, undefined, tickSize);
                } else {
                    apiOrderId = await tInvestService.placeOrder(figi, lots, direction, 'MARKET', undefined, undefined, tickSize);
                }
            } else {
                if (finalPrice > 0) {
                    apiOrderId = await tInvestService.placeOrder(figi, lots, direction, 'LIMIT', finalPrice, undefined, tickSize);
                } else {
                    apiOrderId = await tInvestService.placeOrder(figi, lots, direction, 'MARKET', undefined, undefined, tickSize);
                }
            }
            
            // TITAN-IRONCLAD: Safe Atomic ID Swap
            this.kernel.updateState((prev) => ({
                activeGridOrders: (prev.activeGridOrders || []).map(o => 
                    o.orderId === tempId ? { ...o, orderId: apiOrderId, lastUpdateTime: Date.now() } : o
                )
            }), false);

            this.pendingExecutionIds.delete(tempId);
            
            // NEW: Watch the order for instant fill notifications
            tradeStreamService.watchOrder(apiOrderId);
            
            // ACCOUNTABILITY LOGGING
            const profitInfo = metadata?.expectedProfit ? ` (Profit: +${metadata.expectedProfit.toFixed(2)}%)` : '';
            this.kernel.log(LogType.SUCCESS, `ОРДЕР: ${direction} ${lots} шт. @ ${finalPrice.toFixed(2)}${profitInfo}`);
            
            debugService.logTrace('ExecuteOrder', 'SUCCESS', { figi, lots, apiOrderId });
            
            this.lastActionTime = Date.now(); 

        } catch (e: any) {
            const isAmbiguous = isAmbiguousError(e);
            
            if (isAmbiguous) {
                this.kernel.log(LogType.WARNING, `📡 СЕТЕВОЙ СБОЙ: Статус ордера неизвестен. Удержание блокировки...`);
                debugService.logTrace('ExecuteOrder', 'AMBIGUOUS_ERROR', e.message);
                
                const failState = this.kernel.getState();
                const updatedOrders = (failState.activeGridOrders || []).map(o => {
                    if (o.orderId === tempId) {
                        return { ...o, status: 'UNKNOWN' }; 
                    }
                    return o;
                });
                this.kernel.updateState({ activeGridOrders: updatedOrders }, false);
                this.lastActionTime = Date.now(); 
                return; 
            }

            this.pendingExecutionIds.delete(tempId);

            // TITAN-IRONCLAD: Safe Atomic Rollback
            this.kernel.updateState((prev) => ({
                activeGridOrders: (prev.activeGridOrders || []).filter(o => o.orderId !== tempId)
            }), false);
            
            debugService.logTrace('ExecuteOrder', 'API_FAIL', e.message);
            
            const msg = (e.message || '').toLowerCase(); 
            
            // Broad pattern match to cover both "not enough assets for a margin trade" and "not enough balance"
            if (msg.includes("not enough") || msg.includes("недостаточно")) {
                 this.kernel.log(LogType.WARNING, `⚠️ Отказ брокера (Маржа): Ожидание клиринга блокировок...`);
                 this.kernel.updateState({ effectiveBuyingPower: 0 }, false);
                 this.kernel.dataController.forceMarginRefresh().catch(console.error);
            } 
            else if (msg.includes("rate limit") || msg.includes("429")) {
                 this.kernel.log(LogType.WARNING, `⚠️ API Rate Limit. Пауза.`);
            }
            else {
                 this.kernel.log(LogType.ERROR, `Exec Fail: ${msg}`);
            }
            
            this.lastActionTime = Date.now(); 
            throw e;
        }
    }
}
