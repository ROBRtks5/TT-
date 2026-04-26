
import { BotKernel } from '../bot-kernel';
import { LogType, TradeDirection, GridOrder, PositionStatus, TradeHistoryEntry, MachineState } from '../../types';
import * as tInvestService from '../../services/tInvestService';
import { isAmbiguousError } from '../../services/tInvestApi'; 
import * as debugService from '../../services/debugService';
import * as capitalService from '../../services/capitalService';
import { getServerTimeNow, isMarketOpenNow, getMoscowParts } from '../../utils/marketTime';
import { areEqual, roundPriceToTick } from '../../utils/math'; 
import { AMM_CONFIG, BROKER_FEE_PERCENT } from '../../constants';
import { calculateATR, calculateAPZ, calculateNATR, calculateDonchianChannels } from '../../services/mathStrategyService';
import { tradeStreamService } from '../../services/tradeStreamService';
import { Mutex } from '../../utils/mutex';

const EXECUTION_COOLDOWN_MS = 3000; 
const DATA_STALE_THRESHOLD_MS = 30000; 

export class OrderController {
    private isExecutionInProgress = false;
    private inFlightOrders: Map<string, number> = new Map(); // ГЛОБАЛЬНАЯ ЗАЩИТА: lockKey -> timestamp
    private pendingExecutionIds: Set<string> = new Set();
    private eventMutex = new Mutex(); // Mutex for strict state machine sequential processing
    private logThrottles = new Map<string, number>();
    private isReady: boolean = false; // A-007 Hard-Guard

    private firstPartialFillTime: number = 0;

    constructor(private kernel: BotKernel) {}

    public setReady(ready: boolean) {
        this.isReady = ready;
        this.kernel.log(LogType.INFO, `🛡️ ORDER-CONTROLLER: Статус готовности -> ${ready ? 'READY' : 'LOCKED'}`);
    }

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
        if (!this.isBotRunning()) return;

        // Use Mutex to prevent Race Conditions (State transitions blocked)
        const release = await this.eventMutex.acquire();
        
        try {
            this.kernel.updateState({ machineState: MachineState.REBALANCING }, false);
            
            const msgObj = event.isPartial ? "ЧАСТИЧНОЕ ИСПОЛНЕНИЕ" : "ПОЛНОЕ ИСПОЛНЕНИЕ";
            this.kernel.log(LogType.SUCCESS, `⚡ ${msgObj}: ${event.direction} ${event.quantity} шт. @ ${event.price.toFixed(2)}`);

            // --- Partial Fill Buffering 30s ---
            if (event.isPartial) {
                if (this.firstPartialFillTime === 0) {
                    this.firstPartialFillTime = Date.now();
                }
                const timeSinceFirstPartial = Date.now() - this.firstPartialFillTime;
                if (timeSinceFirstPartial < 30 * 1000) { 
                    this.kernel.log(LogType.INFO, `⏳ Ребалансировка отложена (Partial Fill Cooldown).`);
                    this.kernel.updateState({ machineState: MachineState.TRADING }, false);
                    return; 
                } else {
                    this.firstPartialFillTime = 0; 
                }
            } else {
                this.firstPartialFillTime = 0; 
            }

            // Sync Positions from Core directly to get real AVG and qty since we can have drift
            await this.kernel.dataController.forceMarginRefresh();
            
            const state = this.kernel.getState();
            const figi = state.instrumentDetails?.figi;
            if (!figi) return;

            if (event.direction === TradeDirection.BUY || (event.direction as any) === 'ORDER_DIRECTION_BUY') {
                // EVENT 1: BUY
                this.kernel.log(LogType.INFO, `🔄 Исполнен BUY. Отмена старых SELL и расчет Тейк-Профитов...`);
                
                // 1. Flush SELL
                const sells = (state.activeGridOrders || []).filter(o => o.direction === 'SELL');
                for (const sell of sells) {
                    try { await tInvestService.cancelOrder(sell.orderId); } catch (e) { /* ignore */ }
                }
                
                // 2. Wait for unlock (Vortex Deep Buffer)
                this.kernel.log(LogType.INFO, `⏳ VORTEX: Ожидание разблокировки средств (BUY Phase)...`);
                await new Promise(res => setTimeout(res, 4000));
                await this.kernel.dataController.forceMarginRefresh(); // Refresh AFTER unlock

                // 3. Rebuild SELL
                const updatedState = this.kernel.getState();
                const pos = updatedState.position;
                if (pos && pos.currentQuantity > 0) {
                    const avgPrice = pos.entryPrice;
                    const lotSize = updatedState.instrumentDetails?.lot || 1;
                    const totalAssetQty = pos.currentQuantity;
                    const tp1Qty = Math.floor(totalAssetQty * 0.6);
                    const tp2Qty = totalAssetQty - tp1Qty;

                    const tp1Price = avgPrice * 1.008; // +0.8%
                    const tp2Price = avgPrice * 1.015; // +1.5%

                    if (tp1Qty > 0) await this.executeOrder(figi, tp1Qty, TradeDirection.SELL, tp1Price, { reason: 'TP1' }, updatedState.instrumentDetails?.minPriceIncrement);
                    if (tp2Qty > 0) await this.executeOrder(figi, tp2Qty, TradeDirection.SELL, tp2Price, { reason: 'TP2' }, updatedState.instrumentDetails?.minPriceIncrement);
                }

            } else if (event.direction === TradeDirection.SELL || (event.direction as any) === 'ORDER_DIRECTION_SELL') {
                // EVENT 2: SELL
                this.kernel.log(LogType.INFO, `🔄 Исполнен SELL. Отмена старых BUY и перестроение сетки...`);
                
                // 1. Flush BUY
                const buys = (state.activeGridOrders || []).filter(o => o.direction === 'BUY');
                for (const buy of buys) {
                    try { await tInvestService.cancelOrder(buy.orderId); } catch (e) { /* ignore */ }
                }
                
                // 2. Wait for unlock (Vortex Deep Buffer)
                this.kernel.log(LogType.INFO, `⏳ VORTEX: Ожидание разблокировки средств (SELL Phase)...`);
                await new Promise(res => setTimeout(res, 4000));
                await this.kernel.dataController.forceMarginRefresh(); // Refresh AFTER unlock

                // 3. Rebuild BUY
                const updatedState = this.kernel.getState();
                const currentPrice = updatedState.lastTrades?.[0]?.price || event.price;
                const freeCash = updatedState.effectiveBuyingPower || 0;
                
                if (freeCash > 0) {
                    const lotSize = updatedState.instrumentDetails?.lot || 1;
                    const fractions = [0.10, 0.15, 0.20, 0.25, 0.30];
                    const levels = [0.995, 0.988, 0.978, 0.965, 0.945]; 
                    
                    for (let i = 0; i < 5; i++) {
                        const levelCash = freeCash * fractions[i];
                        const levelPrice = currentPrice * levels[i];
                        const limitLots = Math.floor(levelCash / (levelPrice * lotSize));
                        if (limitLots > 0) {
                            await this.executeOrder(figi, limitLots, TradeDirection.BUY, levelPrice, { reason: `BUY_L${i+1}` }, updatedState.instrumentDetails?.minPriceIncrement);
                        }
                    }
                }
            }

            // Sync active grid to state
            const finalExchangeOrders = await tInvestService.getActiveOrders(figi);
            this.kernel.updateState({ activeGridOrders: finalExchangeOrders, machineState: MachineState.TRADING }, false);

        } catch (e: any) {
            this.kernel.log(LogType.ERROR, `Ошибка Event Loop: ${e.message}`);
            this.kernel.updateState({ machineState: MachineState.TRADING }, false);
        } finally {
            release();
        }
    }

    public async processLifeCycle(force: boolean = false) {
        if (!this.isReady) return;

        // Block if inside an execution event
        if (this.kernel.isSynchronizing) return;

        // Ensure Mutex is acquired to prevent state races
        const release = await this.eventMutex.acquire();

        try {
            const state = this.kernel.getState();
            if (!state.isBotActive) return;

            // --- VORTEX ROBUSTNESS GUARD: MARKET HOURS ---
            
            if (!isMarketOpenNow()) {
                if (this.shouldLog('market_closed_guard', 60000)) {
                    this.kernel.log(LogType.INFO, `🛡️ VORTEX GUARD: Торги закрыты или приостановлены. Ожидание сессии...`);
                }
                return;
            }

            const { hours, minutes } = getMoscowParts();
            const timeInMinutes = hours * 60 + minutes;

            // --- AMNESIA RECOVERY (Холодный старт) & DEEP HOLD ---
            if (state.machineState === MachineState.DEEP_HOLD) {
                const freeCash = state.effectiveBuyingPower || 0;
                const currentPrice = state.lastTrades?.[0]?.price || 0;
                const lotSize = state.instrumentDetails?.lot || 1;
                const costOfOneLot = currentPrice * lotSize;
                
                if (freeCash >= costOfOneLot && currentPrice > 0) {
                     this.kernel.log(LogType.SUCCESS, `🔥 VORTEX: Обнаружен кэш. Выход из DEEP HOLD в режим TRADING.`);
                     this.kernel.updateState({ machineState: MachineState.TRADING }, false);
                     // Let it fall through or return to process next cycle
                     return;
                }
            }

            if (state.machineState === MachineState.TRADING) {
                const buys = (state.activeGridOrders || []).filter(o => o.direction === 'BUY');
                const sells = (state.activeGridOrders || []).filter(o => o.direction === 'SELL');
                const pos = state.position;
                
                // DEEP HOLD Check
                const freeCash = state.effectiveBuyingPower || 0;
                const currentPrice = state.lastTrades?.[0]?.price || 0;
                const lotSize = state.instrumentDetails?.lot || 1;
                const costOfOneLot = currentPrice * lotSize;
                
                if (pos && pos.currentQuantity > 0 && freeCash < costOfOneLot && buys.length === 0) {
                     this.kernel.log(LogType.WARNING, `🧊 КЭШ ИСЧЕРПАН. СИСТЕМА ПЕРЕШЛА В РЕЖИМ 'DEEP HOLD'.`);
                     this.kernel.updateState({ machineState: MachineState.DEEP_HOLD }, false);
                     return;
                }
                
                if (pos && pos.currentQuantity > 0 && sells.length === 0) {
                    // Аномалия: Есть бумаги, но нет SELL (Тейк-профитов). Нужно выставить экстренные SELL.
                    this.kernel.log(LogType.WARNING, `🚨 AMNESIA: Обнаружена неучтенная позиция без SELL-ордеров. Восстановление...`);
                    const figi = state.instrumentDetails?.figi;
                    if (figi) {
                        const avgPrice = pos.entryPrice;
                        const tp1Qty = Math.floor(pos.currentQuantity * 0.6);
                        const tp2Qty = pos.currentQuantity - tp1Qty;
                        if (tp1Qty > 0) await this.executeOrder(figi, tp1Qty, TradeDirection.SELL, avgPrice * 1.008, { reason: 'TP1_AMNESIA' }, state.instrumentDetails?.minPriceIncrement);
                        if (tp2Qty > 0) await this.executeOrder(figi, tp2Qty, TradeDirection.SELL, avgPrice * 1.015, { reason: 'TP2_AMNESIA' }, state.instrumentDetails?.minPriceIncrement);
                    }
                } 
                
                if (buys.length === 0) {
                    const freeCash = state.effectiveBuyingPower || 0;
                    const currentPrice = state.lastTrades?.[0]?.price || pos?.entryPrice || 0;
                    
                    if (freeCash > costOfOneLot && currentPrice > 0 && state.ammCapitalState) {
                        this.kernel.log(LogType.WARNING, `🚨 AMNESIA: Отсутствует сетка BUY. Динамическая ребалансировка...`);
                        
                        const figi = state.instrumentDetails?.figi;
                        if (figi) {
                            const { totalCapitalValue, gridAssetValue } = state.ammCapitalState;
                            const assetWeight = totalCapitalValue > 0 ? (gridAssetValue / totalCapitalValue) : 0;
                            
                            // Target weight is strictly 30%
                            const targetWeight = 0.30;
                            
                            if (assetWeight < targetWeight && (!pos || pos.currentQuantity === 0)) {
                                // CASE A: We are severely underweight (e.g., 0% or <30% on fresh start).
                                // Proactive fill to reach ~30%
                                const deficitCash = totalCapitalValue * (targetWeight - assetWeight);
                                const marketLots = Math.floor(deficitCash / (currentPrice * lotSize));
                                
                                if (marketLots > 0) {
                                    this.kernel.log(LogType.INFO, `🔥 VORTEX: Недобор по весу активов (${(assetWeight*100).toFixed(1)}% < 30%). Выполняется проактивный маркет-ордер!`);
                                    await this.executeOrder(figi, marketLots, TradeDirection.BUY, 0, { reason: 'PROACTIVE_DEFICIT_ENTRY' }, state.instrumentDetails?.minPriceIncrement);
                                }
                                
                                // Lay down standard 70% grid below current price
                                const remainingGridCash = Math.max(0, freeCash - (marketLots * currentPrice * lotSize));
                                const fractions = [0.15, 0.15, 0.20, 0.20, 0.30];
                                const levels = [0.995, 0.988, 0.978, 0.965, 0.945]; 
                                for (let i = 0; i < 5; i++) {
                                    const levelCash = remainingGridCash * fractions[i];
                                    const levelPrice = currentPrice * levels[i];
                                    const limitLots = Math.floor(levelCash / (levelPrice * lotSize));
                                    if (limitLots > 0) {
                                        await this.executeOrder(figi, limitLots, TradeDirection.BUY, levelPrice, { reason: `BUY_GRID_${i+1}` }, state.instrumentDetails?.minPriceIncrement);
                                    }
                                }
                            } else {
                                // CASE B: We are already overweight (e.g., 60% assets, 40% cash) or we already have a position.
                                // We strictly space out the remaining cash defensively, wider and heavier at the bottom.
                                this.kernel.log(LogType.INFO, `🛡️ VORTEX: Активная позиция ${(assetWeight*100).toFixed(1)}%. Расстановка глубокой защитной сетки...`);
                                
                                const baseRefPrice = pos?.entryPrice || currentPrice;
                                
                                // Since we are overweight, we push the nearest order deeper
                                const scaleFactor = assetWeight > targetWeight ? (assetWeight / targetWeight) : 1; 
                                // e.g., if we hold 60% instead of 30%, scaleFactor = 2.0. The drop needed to buy more gets doubled.
                                
                                const baseDrops = [0.01, 0.02, 0.035, 0.055, 0.08]; // 1%, 2%, 3.5%, 5.5%, 8%
                                const levels = baseDrops.map(drop => 1 - (drop * scaleFactor));
                                const fractions = [0.10, 0.15, 0.20, 0.25, 0.30];
                                
                                for (let i = 0; i < 5; i++) {
                                    const levelCash = freeCash * fractions[i];
                                    const levelPrice = baseRefPrice * levels[i];
                                    const limitLots = Math.floor(levelCash / (levelPrice * lotSize));
                                    if (limitLots > 0) {
                                        await this.executeOrder(figi, limitLots, TradeDirection.BUY, levelPrice, { reason: `BUY_DEFENSIVE_GRID_${i+1}` }, state.instrumentDetails?.minPriceIncrement);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            
            // --- PHASE 5: TMON NIGHT PARKING ---
            // Consts for thresholds
            const NIGHT_SLEEP_START = 23 * 60 + 40; // 23:40
            const MORNING_WAKEUP = 10 * 60 + 5;     // 10:05
            const MORNING_END = 10 * 60 + 15;       // 10:15
            
            // NIGHT PARK INITIATE (At 23:40+)
            if (timeInMinutes >= NIGHT_SLEEP_START) {
                if (state.machineState === MachineState.TRADING || state.machineState === MachineState.DEEP_HOLD) {
                    this.kernel.log(LogType.SYSTEM, "🌜 23:40 MSK: ЗАПУСК НОЧНОГО СТАЛКЕРА. ПАРКОВКА В TMON@...");
                    this.kernel.updateState({ machineState: MachineState.EOD_SWEEP }, false);
                    
                    // Cancel all BUY orders on main stock
                    const buys = (state.activeGridOrders || []).filter(o => o.direction === 'BUY');
                    for (const buy of buys) {
                        try { await tInvestService.cancelOrder(buy.orderId); } catch (e) { /* ignore */ }
                    }
                    
                    // Pause for balance unlock (Vortex Deep Buffer)
                    this.kernel.log(LogType.INFO, `⏳ VORTEX: Ожидание разблокировки средств (Ночная парковка)...`);
                    await new Promise(res => setTimeout(res, 4000));
                    await this.kernel.dataController.forceMarginRefresh();
                    
                    const freeCash = this.kernel.getState().effectiveBuyingPower || 0;
                    if (freeCash > 1) { // TMON is around 1 ruble
                         try {
                             const tmonRes = await tInvestService.resolveFigi('TMON@', true);
                             const TMON_FIGI = tmonRes.figi;
                             const tmonLots = Math.floor(freeCash); 
                             await this.executeOrder(TMON_FIGI, tmonLots, TradeDirection.BUY, 0, { reason: 'NIGHT_PARK_TMON' });
                             this.kernel.updateState({ machineState: MachineState.NIGHT_PARK }, false);
                         } catch (e) {
                             this.kernel.log(LogType.WARNING, `⚠️ Ошибка парковки TMON: не найден FIGI или сбой сети.`);
                             this.kernel.updateState({ machineState: MachineState.NIGHT_PARK }, false);
                         }
                    } else {
                        this.kernel.updateState({ machineState: MachineState.NIGHT_PARK }, false);
                    }
                }
            }

            // MORNING WAKEUP INITIATE (At 10:05+)
            if (timeInMinutes >= MORNING_WAKEUP && timeInMinutes < MORNING_END) {
                const holdsLiquidityFunds = (state.ammCapitalState?.liquidityFundValue || 0) > 0;
                if (state.machineState === MachineState.NIGHT_PARK || state.machineState === MachineState.EOD_SWEEP || holdsLiquidityFunds) {
                     this.kernel.log(LogType.SYSTEM, "☀️ 10:05 MSK: УТРЕННЕЕ ПРОБУЖДЕНИЕ. ПРОДАЖА ФОНДОВ ЛИКВИДНОСТИ...");
                     this.kernel.updateState({ machineState: MachineState.MORNING_WAKEUP }, false);
                     
                     try {
                         // We track both TMON and LQDT as funds. If holdsLiquidityFunds is true, we must fetch and sell them
                         const portfolio = await tInvestService.getPortfolio();
                         const mmFunds = portfolio.positions.filter((p: any) => p.figi === 'TCS00A1010H1' /* TMON */ || p.figi === 'TCS00A104TS6' /* LQDT */);
                         
                         for (const p of mmFunds) {
                             const qty = tInvestService.mapToNumber(p.quantity);
                             if (qty > 0) {
                                 const figi = p.figi;
                                 await this.executeOrder(figi, qty, TradeDirection.SELL, 0, { reason: 'MORNING_WAKEUP_SELL' });
                             }
                         }
                     } catch (e) {
                         this.kernel.log(LogType.WARNING, `⚠️ Ошибка пробуждения TMON: сбой сети или структуры портфеля.`);
                     }
                     
                     // Delay to wait cash to arrive (Vortex Deep Buffer)
                     this.kernel.log(LogType.INFO, `⏳ VORTEX: Ожидание клиринга утренних средств...`);
                     await new Promise(res => setTimeout(res, 4000));
                     await this.kernel.dataController.forceMarginRefresh();
                     
                     this.kernel.updateState({ machineState: MachineState.TRADING }, false);
                }
            }

        } catch (e: any) {
            this.kernel.log(LogType.ERROR, `Lifecycle Error: ${e.message}`);
        } finally {
            release();
        }
    }

    public async executeOrder(
        figi: string, 
        lots: number, 
        direction: TradeDirection, 
        limitPrice?: number, 
        metadata?: GridOrder['metadata'],
        tickSize: number = 0.01,
        idempotencyKey?: string
    ) {
        const state = this.kernel.getState();
        const minIncrement = state.instrumentDetails?.minPriceIncrement || tickSize;
        // STRICT GUARD (PHASE 16): BLOCK ALL EXECUTION DURING SYNC
        if (this.kernel.isSynchronizing) {
            this.kernel.log(LogType.WARNING, "🛡️ GRID GUARD: Блокировка транзакции (Идет синхронизация).");
            return;
        }

        if (lots <= 0) return;
        
        let finalPrice = limitPrice || 0;

        // --- TICK ALIGNMENT (CRITICAL) ---
        if (finalPrice > 0) {
            finalPrice = roundPriceToTick(finalPrice, minIncrement);
        }

        // --- CENTRALIZED IDEMPOTENCY ---
        const finalIdempotencyKey = idempotencyKey || `VORTEX-${figi}-${direction}-${metadata?.reason || 'SYS'}-${Date.now()}`;


        // --- CASH CHECK (OPTIMIZED: Use State) ---
        if (direction === TradeDirection.BUY) {
            try {
                // VORTEX STRICT CHECK
                const power = state.effectiveBuyingPower || 0;
                const lotSize = state.instrumentDetails?.lot || 1;
                const estimatedCost = finalPrice * lots * lotSize;
                
                if (estimatedCost > power) { 
                    const msg = `⚠️ ОТКЛОНЕНО (Недостаточно средств): Ордер ${lots} лотов @ ${finalPrice} (Cost: ${estimatedCost.toFixed(2)}) > Бюджет (${power.toFixed(2)}).`;
                    this.kernel.log(LogType.WARNING, msg);
                    return; // Prevent execution!!
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
            debugService.logTrace('ExecuteOrder', 'SENDING', { figi, lots, direction, price: finalPrice, orderId: tempId });

            let apiOrderId: string;
            
            if (direction === TradeDirection.SELL) {
                if (finalPrice > 0) {
                    apiOrderId = await tInvestService.placeOrder(figi, lots, direction, 'LIMIT', finalPrice, tempId, tickSize, finalIdempotencyKey);
                } else {
                    apiOrderId = await tInvestService.placeOrder(figi, lots, direction, 'MARKET', undefined, tempId, tickSize, finalIdempotencyKey);
                }
            } else {
                if (finalPrice > 0) {
                    apiOrderId = await tInvestService.placeOrder(figi, lots, direction, 'LIMIT', finalPrice, tempId, tickSize, finalIdempotencyKey);
                } else {
                    apiOrderId = await tInvestService.placeOrder(figi, lots, direction, 'MARKET', undefined, tempId, tickSize, finalIdempotencyKey);
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
            
            throw e;
        }
    }
}
