
import { BotKernel } from '../bot-kernel';
import { LogType, TradeDirection, GridOrder, PositionStatus, TradeHistoryEntry, MachineState } from '../../types';
import * as tInvestService from '../../services/tInvestService';
import { isAmbiguousError } from '../../services/tInvestApi'; 
import * as debugService from '../../services/debugService';
import * as capitalService from '../../services/capitalService';
import { getServerTimeNow, isMarketOpenNow, getMoscowParts } from '../../utils/marketTime';
import { areEqual, roundPriceToTick } from '../../utils/math'; 
import { AMM_CONFIG, BROKER_FEE_PERCENT } from '../../constants';
import { calculateADX, calculateAPZ, calculateNATR, calculateDonchianChannels } from '../../services/mathStrategyService';
import { tradeStreamService } from '../../services/tradeStreamService';
import { Mutex } from '../../utils/mutex';

export class OrderController {
    public eventMutex = new Mutex(); // Mutex for strict state machine sequential processing
    private logThrottles = new Map<string, number>();
    private isReady: boolean = false; // A-007 Hard-Guard
    private isDeployingGrid: boolean = false; // TITAN: Atomic Deployment Lock
    private lastDeploymentTime: number = 0; 

    private firstPartialFillTime: number = 0;
    private partialFillTimer: NodeJS.Timeout | null = null;

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
        let originalMachineState = this.kernel.getState().machineState;
        
        try {
            if (!this.kernel.getState().isBotActive) return;
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
                    
                    if (this.partialFillTimer) clearTimeout(this.partialFillTimer);
                    this.partialFillTimer = setTimeout(() => {
                        this.firstPartialFillTime = 0;
                        if (this.kernel.getState().isBotActive) {
                            this.handleOrderFill({ ...event, isPartial: false }).catch(console.error);
                        }
                    }, 30 * 1000 - timeSinceFirstPartial);

                    const safeState = (originalMachineState === MachineState.MORNING_SELL_ONLY || originalMachineState === MachineState.MORNING_WAKEUP || originalMachineState === MachineState.EOD_SWEEP || originalMachineState === MachineState.NIGHT_PARK) 
                         ? originalMachineState : MachineState.TRADING;
                    this.kernel.updateState({ machineState: safeState }, false);
                    return; 
                } else {
                    this.firstPartialFillTime = 0; 
                    if (this.partialFillTimer) clearTimeout(this.partialFillTimer);
                    this.partialFillTimer = null;
                }
            } else {
                this.firstPartialFillTime = 0; 
                if (this.partialFillTimer) clearTimeout(this.partialFillTimer);
                this.partialFillTimer = null;
            }

            // Sync Positions from Core directly to get real AVG and qty since we can have drift
            await this.kernel.dataController.forceMarginRefresh();
            
            const state = this.kernel.getState();
            const figi = state.instrumentDetails?.figi;
            if (!figi) return;
            
            // TITAN-GUARD: Drop stale events from previous instruments
            if (event.figi && event.figi !== figi) {
                 this.kernel.log(LogType.WARNING, `🛡️ DEAD-MAN SWITCH: Игнорирование OrderFill для старого инструмента ${event.figi}`);
                 return;
            }

            if (event.direction === TradeDirection.BUY || (event.direction as any) === 'ORDER_DIRECTION_BUY') {
                // EVENT 1: BUY
                this.kernel.log(LogType.INFO, `🔄 Исполнен BUY. Отмена старых SELL и расчет Тейк-Профитов...`);
                
                // 1. Flush SELL
                let cancelledCount = 0;
                try {
                    cancelledCount = await tInvestService.cancelAllOrders(figi, 5, TradeDirection.SELL);
                } catch(e: any) {
                    this.kernel.log(LogType.WARNING, `⚠️ Отмена SELL: ${e.message}`);
                }
                if (!this.kernel.getState().isBotActive) return;
                
                // 2. Wait for unlock (Vortex Deep Buffer)
                if (cancelledCount > 0) {
                    this.kernel.log(LogType.INFO, `⏳ VORTEX: Ожидание разблокировки средств (${cancelledCount} шт, BUY Phase)...`);
                    await new Promise(res => setTimeout(res, 4000));
                }
                
                // Sync grid to clear cancelled orders from state BEFORE margin calculation
                const preMarginOrdersSync = await tInvestService.getActiveOrders(figi);
                this.kernel.updateState({ activeGridOrders: preMarginOrdersSync }, false);
                await this.kernel.dataController.forceMarginRefresh(); // Refresh AFTER unlock

                // 3. Rebuild SELL
                const updatedState = this.kernel.getState();
                const pos = updatedState.position;
                if (pos && pos.currentQuantity > 0) {
                    this.lastDeploymentTime = getServerTimeNow();
                    await this.deploySellGrid(figi, pos.entryPrice, pos.currentQuantity);
                }

            } else if (event.direction === TradeDirection.SELL || (event.direction as any) === 'ORDER_DIRECTION_SELL') {
                // EVENT 2: SELL
                this.kernel.log(LogType.INFO, `🔄 Исполнен SELL. Отмена старых BUY и перестроение сетки...`);
                
                // 1. Flush BUY
                let cancelledCount = 0;
                try {
                    cancelledCount = await tInvestService.cancelAllOrders(figi, 5, TradeDirection.BUY);
                } catch(e: any) {
                    this.kernel.log(LogType.WARNING, `⚠️ Отмена BUY: ${e.message}`);
                }
                if (!this.kernel.getState().isBotActive) return;
                
                // 2. Wait for unlock (Vortex Deep Buffer)
                if (cancelledCount > 0) {
                    this.kernel.log(LogType.INFO, `⏳ VORTEX: Ожидание разблокировки средств (${cancelledCount} шт, SELL Phase)...`);
                    await new Promise(res => setTimeout(res, 4000));
                }
                
                // Sync grid to clear cancelled orders from state BEFORE margin calculation
                const preMarginOrdersSync2 = await tInvestService.getActiveOrders(figi);
                this.kernel.updateState({ activeGridOrders: preMarginOrdersSync2 }, false);
                await this.kernel.dataController.forceMarginRefresh(); // Refresh AFTER unlock

                // 3. Rebuild BUY
                const updatedState = this.kernel.getState();
                const pos = updatedState.position;
                const posQty = pos?.currentQuantity || 0;
                const currentPrice = updatedState.lastTrades?.[0]?.price || event.price;
                const freeCash = updatedState.effectiveBuyingPower || 0;
                
                if (freeCash > 0 && originalMachineState !== MachineState.MORNING_SELL_ONLY && originalMachineState !== MachineState.MORNING_WAKEUP) {
                    this.lastDeploymentTime = getServerTimeNow();
                    await this.deployBuyGrid(figi, currentPrice, freeCash, posQty);
                }
            }

            // Sync active grid to state
            const finalExchangeOrders = await tInvestService.getActiveOrders(figi);
            const targetState = (originalMachineState === MachineState.MORNING_SELL_ONLY || originalMachineState === MachineState.MORNING_WAKEUP || originalMachineState === MachineState.EOD_SWEEP || originalMachineState === MachineState.NIGHT_PARK) 
                 ? originalMachineState : MachineState.TRADING;
            this.kernel.updateState({ activeGridOrders: finalExchangeOrders, machineState: targetState }, false);

        } catch (e: any) {
            this.kernel.log(LogType.ERROR, `Ошибка Event Loop: ${e.message}`);
            const targetState = (originalMachineState === MachineState.MORNING_SELL_ONLY || originalMachineState === MachineState.MORNING_WAKEUP || originalMachineState === MachineState.EOD_SWEEP || originalMachineState === MachineState.NIGHT_PARK) 
                 ? originalMachineState : MachineState.TRADING;
            this.kernel.updateState({ machineState: targetState }, false);
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

            // --- VORTEX ROBUSTNESS GUARD: MARKET HOURS & STATE ENFORCEMENT ---
            const { hours, minutes } = getMoscowParts();
            const timeInMinutes = hours * 60 + minutes;

            // Consts for thresholds
            const NIGHT_SLEEP_START = 23 * 60 + 40; // 23:40
            const MORNING_SELL_START = 7 * 60;      // 07:00
            const MORNING_WAKEUP = 10 * 60 + 5;     // 10:05
            const MORNING_END = 10 * 60 + 15;       // 10:15

            // Before skipping due to market closed, ensure we're in the correct phase.
            // If the time is during the deep night, we MUST be in NIGHT_PARK or DEEP_HOLD.
            // To prevent staying in TRADING if we just booted at 3 AM.
            if (!isMarketOpenNow()) {
                if (timeInMinutes >= NIGHT_SLEEP_START || timeInMinutes < MORNING_SELL_START) {
                    if (state.machineState === MachineState.TRADING || state.machineState === MachineState.MORNING_SELL_ONLY) {
                         this.kernel.log(LogType.WARNING, `🛡️ Авто-коррекция состояния: Ночь. Переход в NIGHT_PARK.`);
                         this.kernel.updateState({ machineState: MachineState.NIGHT_PARK }, false);
                    }
                }
                if (this.shouldLog('market_closed_guard', 60000)) {
                    this.kernel.log(LogType.INFO, `🛡️ VORTEX GUARD: Торги закрыты или приостановлены. Ожидание сессии...`);
                }
                return;
            }

            // --- AMNESIA RECOVERY (Холодный старт) & DEEP HOLD ---
            if (state.machineState === MachineState.DEEP_HOLD) {
                const freeCash = state.effectiveBuyingPower || 0;
                const currentPrice = state.lastTrades?.[0]?.price || state.chartData?.['1m']?.slice(-1)[0]?.price || state.position?.entryPrice || 0;
                const lotSize = state.instrumentDetails?.lot || 1;
                const costOfOneLot = currentPrice * lotSize;
                
                if (freeCash >= costOfOneLot && currentPrice > 0) {
                     this.kernel.log(LogType.SUCCESS, `🔥 VORTEX: Обнаружен кэш. Выход из DEEP HOLD в режим TRADING.`);
                     this.kernel.updateState({ machineState: MachineState.TRADING }, false);
                     // Let it fall through or return to process next cycle
                     return;
                }
            }

            if (state.machineState === MachineState.TRADING || state.machineState === MachineState.MORNING_SELL_ONLY || state.machineState === MachineState.DEEP_HOLD) {
                const buys = (state.activeGridOrders || []).filter(o => o.direction === 'BUY');
                const sells = (state.activeGridOrders || []).filter(o => o.direction === 'SELL');
                const pos = state.position;
                const freeCash = state.effectiveBuyingPower || 0;
                const currentPrice = state.lastTrades?.[0]?.price || state.chartData?.['1m']?.slice(-1)[0]?.price || pos?.entryPrice || 0;
                const lotSize = state.instrumentDetails?.lot || 1;
                const costOfOneLot = currentPrice * lotSize;
                
                // 1. CRITICAL: AMNESIA SELL RECOVERY MUST RUN BEFORE DEEP HOLD
                // If we hold assets but our SELL targets don't match the quantity (unhedged or over-hedged), restore immediately.
                const totalSellQty = sells.reduce((acc, o) => acc + o.qty, 0);
                if (pos && pos.currentQuantity > 0 && totalSellQty !== pos.currentQuantity && !this.isDeployingGrid) {
                    const now = getServerTimeNow();
                    if (now - this.lastDeploymentTime < 15000) return; // Wait 15s between grid deployments

                    this.kernel.log(LogType.WARNING, `🚨 AMNESIA: Дисбаланс SELL-ордеров (${totalSellQty} vs ${pos.currentQuantity}). Рекалибровка...`);
                    const figi = state.instrumentDetails?.figi;
                    if (figi) {
                        try {
                            this.isDeployingGrid = true;
                            // Target cancel ONLY SELL orders to prevent destroying BUY grids
                            if (sells.length > 0) {
                                try {
                                    await tInvestService.cancelAllOrders(figi, 5, TradeDirection.SELL);
                                } catch (e: any) {
                                    this.kernel.log(LogType.WARNING, `⚠️ Частичная отмена SELL ордеров: ${e.message}`);
                                }
                                if (!this.kernel.getState().isBotActive) return;
                            }
                            
                            await this.deploySellGrid(figi, pos.entryPrice, pos.currentQuantity);
                            
                            // Mandatory Wait for API to ingest orders
                            await new Promise(res => setTimeout(res, 3000));
                            if (!this.kernel.getState().isBotActive) return;
                            
                            // Fetch new grid orders and sync state
                            const updatedOrders = await tInvestService.getActiveOrders(figi);
                            this.kernel.updateState({ activeGridOrders: updatedOrders }, false);
                            this.lastDeploymentTime = getServerTimeNow();
                            this.kernel.log(LogType.SUCCESS, `✅ AMNESIA: Сетка SELL восстановлена (${pos.currentQuantity} шт).`);
                        } finally {
                            this.isDeployingGrid = false;
                        }
                    }
                    return; // Yield cycle so state refreshes safely
                } 

                // 2. DEEP HOLD Check
                if (state.machineState === MachineState.TRADING && pos && pos.currentQuantity > 0 && freeCash < costOfOneLot && buys.length === 0) {
                     this.kernel.log(LogType.WARNING, `🧊 КЭШ ИСЧЕРПАН. СИСТЕМА ПЕРЕШЛА В РЕЖИМ 'DEEP HOLD'.`);
                     this.kernel.updateState({ machineState: MachineState.DEEP_HOLD }, false);
                     return;
                }
                
                // 3. BUY GRID RECOVERY OR DEPLOYMENT
                // If we are in TRADING but have no BUY orders (and not in cash preservation), redeploy.
                if (state.machineState === MachineState.TRADING && buys.length === 0 && !this.isDeployingGrid) {
                    const power = state.effectiveBuyingPower || 0;
                    const currentPrice = state.lastTrades?.[0]?.price || pos?.entryPrice || 0;
                    const lotSize = state.instrumentDetails?.lot || 1;
                    const costOfOneLot = currentPrice * lotSize;
                    
                    if (power >= costOfOneLot && currentPrice > 0 && state.ammCapitalState) {
                        const now = getServerTimeNow();
                        if (now - this.lastDeploymentTime < 15000) return;

                        this.kernel.log(LogType.WARNING, `🚨 AMNESIA: Отсутствует сетка BUY. Динамическая ребалансировка...`);
                        
                        const figi = state.instrumentDetails?.figi;
                        if (figi) {
                            try {
                                this.isDeployingGrid = true;
                                const posQty = pos?.currentQuantity || 0;
                                
                                // Clean existing BUYS just in case (e.g. unknown state on exchange)
                                try {
                                    await tInvestService.cancelAllOrders(figi, 5, TradeDirection.BUY);
                                } catch (e: any) {
                                    this.kernel.log(LogType.WARNING, `⚠️ Частичная отмена BUY ордеров: ${e.message}`);
                                }
                                if (!this.kernel.getState().isBotActive) return;

                                await this.deployBuyGrid(figi, currentPrice, power, posQty);
                                
                                await new Promise(res => setTimeout(res, 3000));
                                if (!this.kernel.getState().isBotActive) return;
                                
                                const updatedOrders = await tInvestService.getActiveOrders(figi);
                                this.kernel.updateState({ activeGridOrders: updatedOrders }, false);
                                this.lastDeploymentTime = getServerTimeNow();
                                this.kernel.log(LogType.SUCCESS, `✅ AMNESIA: Сетка BUY развернута.`);
                            } finally {
                                this.isDeployingGrid = false;
                            }
                        }
                    }
                }
            }
            
            const mainFigi = state.instrumentDetails?.figi || '';

            // --- PHASE 5: TMON NIGHT PARKING & MORNING PHASES ---

            // --- MORNING SELL ONLY PHASE (07:00 - 10:05) ---
            if (timeInMinutes >= MORNING_SELL_START && timeInMinutes < MORNING_WAKEUP) {
                if (state.machineState !== MachineState.MORNING_SELL_ONLY) {
                    this.kernel.log(LogType.SYSTEM, "🌅 07:00 MSK: УТРЕННЯЯ СЕССИЯ. РАЗРЕШЕНЫ ТОЛЬКО ПРОДАЖИ (ДО 10:05)...");
                    this.kernel.updateState({ machineState: MachineState.MORNING_SELL_ONLY }, false);
                    
                    // Cancel all existing BUY orders to prevent early buys
                    try {
                        if (mainFigi) await tInvestService.cancelAllOrders(mainFigi, 3, TradeDirection.BUY);
                    } catch (e: any) {
                        this.kernel.log(LogType.WARNING, `⚠️ MORNING_SELL_ONLY: Ошибка отмены BUY: ${e.message}`);
                    }
                }
            }
            
            // NIGHT PARK INITIATE (At 23:40+ or 00:00 - 07:00)
            if (timeInMinutes >= NIGHT_SLEEP_START || timeInMinutes < MORNING_SELL_START) {
                if (state.machineState === MachineState.TRADING || state.machineState === MachineState.MORNING_SELL_ONLY || state.machineState === MachineState.DEEP_HOLD) {
                    this.kernel.log(LogType.SYSTEM, "🌜 23:40 MSK: ЗАПУСК НОЧНОГО СТАЛКЕРА. ПАРКОВКА В TMON@...");
                    this.kernel.updateState({ machineState: MachineState.EOD_SWEEP }, false);
                    
                    // Cancel all BUY orders on main stock
                    let cancelledCount = 0;
                    try {
                        if (mainFigi) cancelledCount = await tInvestService.cancelAllOrders(mainFigi, 3, TradeDirection.BUY);
                    } catch (e: any) {
                        this.kernel.log(LogType.WARNING, `⚠️ NIGHT_PARK: Ошибка отмены BUY: ${e.message}`);
                    }
                    
                    // Pause for balance unlock (Vortex Deep Buffer)
                    if (cancelledCount > 0) {
                        this.kernel.log(LogType.INFO, `⏳ VORTEX: Ожидание разблокировки средств (Ночная парковка)...`);
                        if (!this.kernel.getState().isBotActive) return;
                        await new Promise(res => setTimeout(res, 4000));
                        if (!this.kernel.getState().isBotActive) return;
                    }
                    await this.kernel.dataController.forceMarginRefresh();
                    
                    const freeCash = this.kernel.getState().effectiveBuyingPower || 0;
                    if (freeCash > 1) { // TMON is around 1 ruble
                         try {
                             let TMON_FIGI = this.kernel.getState().liquidityFundFigi;
                             let tmonLotObj = 1;
                             if (!TMON_FIGI) {
                                 const tmonRes = await tInvestService.resolveFigi('TMON@', true);
                                 TMON_FIGI = tmonRes.figi;
                                 tmonLotObj = tmonRes.lot || 1;
                             }
                             if (TMON_FIGI) {
                                 const pricesDict = await tInvestService.getLastPrices([TMON_FIGI]);
                                 const tmonPrice = pricesDict[TMON_FIGI] || 1.05;
                                 const tmonLots = Math.floor((freeCash * 0.98) / (tmonPrice * tmonLotObj)); 
                                 if (tmonLots > 0) {
                                     await this.executeOrder(TMON_FIGI, tmonLots, TradeDirection.BUY, 0, { reason: 'NIGHT_PARK_TMON' });
                                 }
                             }
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
                
                // Only enter this block ONCE. If we are already in MORNING_WAKEUP, we skip it to prevent duplicating sell orders for funds.
                if (state.machineState === MachineState.NIGHT_PARK || state.machineState === MachineState.EOD_SWEEP || state.machineState === MachineState.MORNING_SELL_ONLY) {
                     this.kernel.log(LogType.SYSTEM, "☀️ 10:05 MSK: РАЗБЛОКИРОВКА ФОНДОВ (FUNDS_UNLOCKING). ПРОДАЖА ФОНДОВ ЛИКВИДНОСТИ...");
                     this.kernel.updateState({ machineState: MachineState.MORNING_WAKEUP }, false);
                     
                     let ordersPlacedCount = 0;
                     try {
                         // We track both TMON and LQDT as funds. If holdsLiquidityFunds is true, we must fetch and sell them
                         const portfolio = await tInvestService.getPortfolio();
                         const mmFunds = portfolio.positions.filter((p: any) => 
                             p.figi === 'TCS00A1010H1' /* Legacy TMON */ || 
                             p.figi === 'TCS00A104TS6' /* LQDT */ ||
                             p.figi === 'TCS00A105P80' /* TMON@ */ || 
                             p.figi === 'TCS00A1061C4' /* TMON NEW */ ||
                             (state.liquidityFundFigi && p.figi === state.liquidityFundFigi)
                         );
                         
                         for (const p of mmFunds) {
                             // Attempt to map available quantity. If `blocked` exists in the API, we subtract it.
                             let qty = tInvestService.mapToNumber(p.quantity);
                             if (p.blocked) {
                                 const blockedQty = typeof p.blocked === 'boolean' ? (p.blocked ? qty : 0) : tInvestService.mapToNumber(p.blocked);
                                 qty -= blockedQty;
                             }
                             
                             if (qty > 0) {
                                 const figi = p.figi;
                                 
                                 // "with Best Bid price" the user requested limit sell with Best Bid price.
                                 const orderbook = await tInvestService.getOrderBook(figi, 1);
                                 let limitPrice = 0;
                                 if (orderbook && orderbook.bids.length > 0) {
                                     limitPrice = orderbook.bids[0].price;
                                 }
                                 
                                 if (limitPrice > 0) {
                                     await this.executeOrder(figi, qty, TradeDirection.SELL, limitPrice, { reason: 'MORNING_WAKEUP_SELL' });
                                     ordersPlacedCount++;
                                 } else {
                                     this.kernel.log(LogType.WARNING, `⚠️ Невозможно продать фонд ликвиности (Нет Bid цены) - Отмена.`);
                                 }
                             }
                         }
                     } catch (e) {
                         this.kernel.log(LogType.WARNING, `⚠️ Ошибка пробуждения TMON: сбой сети или структуры портфеля.`);
                     }
                     
                     // Delay to wait cash to arrive (Vortex Deep Buffer)
                     if (ordersPlacedCount > 0) {
                         this.kernel.log(LogType.INFO, `⏳ VORTEX: Ожидание клиринга утренних средств...`);
                         if (!this.kernel.getState().isBotActive) return;
                         await new Promise(res => setTimeout(res, 4000));
                         if (!this.kernel.getState().isBotActive) return;
                     }
                     await this.kernel.dataController.forceMarginRefresh();
                     
                     // Do NOT transition to TRADING here. Let the next block handle it.
                } else if (state.machineState === MachineState.MORNING_WAKEUP && holdsLiquidityFunds) {
                     // During MORNING_WAKEUP, we might still have funds (e.g. order pending). 
                     // Just refresh margin periodically but don't spam sell orders.
                     const now = Date.now();
                     const lastReq = this.logThrottles.get('wakeup_margin_refresh') || 0;
                     if (now - lastReq > 15000) {
                         this.logThrottles.set('wakeup_margin_refresh', now);
                         await this.kernel.dataController.forceMarginRefresh();
                     }
                }
            }

            // MAIN SESSION START (At 10:15+)
            if (timeInMinutes >= MORNING_END && timeInMinutes < NIGHT_SLEEP_START) {
                if (state.machineState === MachineState.MORNING_WAKEUP || state.machineState === MachineState.MORNING_SELL_ONLY || state.machineState === MachineState.NIGHT_PARK) {
                    this.kernel.log(LogType.SYSTEM, "🚀 10:15 MSK: СТАРТ ОСНОВНОЙ СЕССИИ. ПЕРЕХОД В РЕЖИМ TRADING...");
                    this.kernel.updateState({ machineState: MachineState.TRADING }, false);
                }
            }

        } catch (e: any) {
            this.kernel.log(LogType.ERROR, `Lifecycle Error: ${e.message}`);
        } finally {
            release();
        }
    }

    private async deploySellGrid(figi: string, avgPrice: number, totalAssetQty: number) {
        const state = this.kernel.getState();
        
        // --- IRONCLAD GUARD: PROTECT AGAINST 0 AVG PRICE (API GLITCH) ---
        let safeAvgPrice = avgPrice;
        if (!safeAvgPrice || safeAvgPrice <= 0) {
            safeAvgPrice = state.lastTrades?.[0]?.price || state.chartData?.['1m']?.slice(-1)[0]?.price || 0;
            if (safeAvgPrice <= 0) {
                this.kernel.log(LogType.ERROR, `🛡️ IRONCLAD GUARD: Невозможно определить цену для сетки SELL! Отмена.`);
                return;
            }
        }
        
        let tp1Qty = Math.floor(totalAssetQty * 0.50);
        let tp2Qty = Math.floor(totalAssetQty * 0.33);
        let tp3Qty = Math.max(0, totalAssetQty - tp1Qty - tp2Qty);
        
        // Smart shift for low quantities
        if (totalAssetQty === 1) {
            tp1Qty = 1; tp2Qty = 0; tp3Qty = 0;
        } else if (totalAssetQty === 2) {
            tp1Qty = 1; tp2Qty = 1; tp3Qty = 0;
        } else if (totalAssetQty > 0 && tp1Qty === 0) {
            // Failsafe allocation
            tp1Qty = totalAssetQty; tp2Qty = 0; tp3Qty = 0;
        }
        
        const candles = state.chartData?.['1m'] || [];
        const apz = calculateAPZ(candles, 20);
        const donchian = calculateDonchianChannels(candles, 20);

        let tp1Price = safeAvgPrice * 1.008; 
        let tp2Price = safeAvgPrice * 1.015;
        let tp3Price = safeAvgPrice * 1.025;

        if (apz.upper > safeAvgPrice * 1.006) tp1Price = apz.upper;
        if (donchian.upper > tp1Price * 1.005) {
            tp2Price = donchian.upper;
            tp3Price = tp2Price * 1.01;
        }

        tp1Price = Math.max(tp1Price, safeAvgPrice * 1.006);
        tp2Price = Math.max(tp2Price, tp1Price * 1.005);
        tp3Price = Math.max(tp3Price, tp2Price * 1.005);
        
        tp1Price = Math.min(tp1Price, safeAvgPrice * 1.03);
        tp2Price = Math.min(tp2Price, safeAvgPrice * 1.10);
        tp3Price = Math.min(tp3Price, safeAvgPrice * 1.20);
        
        const limitUp = state.orderBook?.limitUp;
        if (limitUp && limitUp > 0) {
            const safeUp = limitUp * 0.9995;
            tp1Price = Math.min(tp1Price, safeUp);
            tp2Price = Math.min(tp2Price, safeUp);
            tp3Price = Math.min(tp3Price, safeUp);
        }

        // Aggregate orders by rounded tick price to prevent spamming broker at the same level
        const tickSize = state.instrumentDetails?.minPriceIncrement || 0.01;
        const sellOrdersMap = new Map<number, { qty: number, reason: string }>();

        const addSellOrder = (qty: number, price: number, reason: string) => {
            const finalPrice = roundPriceToTick(price, tickSize);
            if (sellOrdersMap.has(finalPrice)) {
                const existing = sellOrdersMap.get(finalPrice)!;
                existing.qty += qty;
                existing.reason += ` + ${reason}`;
            } else {
                sellOrdersMap.set(finalPrice, { qty, reason });
            }
        };

        if (tp1Qty > 0) addSellOrder(tp1Qty, tp1Price, 'TP1');
        if (tp2Qty > 0) addSellOrder(tp2Qty, tp2Price, 'TP2');
        if (tp3Qty > 0) addSellOrder(tp3Qty, tp3Price, 'TP3');

        const promises = [];
        for (const [price, info] of sellOrdersMap.entries()) {
            promises.push(this.executeOrder(figi, info.qty, TradeDirection.SELL, price, { reason: info.reason }, tickSize));
        }
        
        await Promise.allSettled(promises);
    }

    private async deployBuyGrid(figi: string, currentPrice: number, freeCash: number, posQty: number) {
        const state = this.kernel.getState();
        if (!state.ammCapitalState) return;

        if (currentPrice <= 0) {
            this.kernel.log(LogType.ERROR, `🛡️ VORTEX GUARD: deployBuyGrid отменен. Неизвестна цена актива (${currentPrice}).`);
            return;
        }

        const lotSize = state.instrumentDetails?.lot || 1;
        const { totalCapitalValue, gridAssetValue } = state.ammCapitalState;
        const assetWeight = totalCapitalValue > 0 ? (gridAssetValue / totalCapitalValue) : 0;
        const targetWeight = 0.30;
        
        if (assetWeight < targetWeight && posQty === 0) {
            const deficitCash = totalCapitalValue * (targetWeight - assetWeight);
            const marketLots = Math.floor(deficitCash / (currentPrice * lotSize));
            
            if (marketLots > 0) {
                this.kernel.log(LogType.INFO, `🔥 VORTEX: Недобор по весу активов (${(assetWeight*100).toFixed(1)}% < 30%). Выполняется проактивный маркет-ордер!`);
                await this.executeOrder(figi, marketLots, TradeDirection.BUY, 0, { reason: 'PROACTIVE_DEFICIT_ENTRY' }, state.instrumentDetails?.minPriceIncrement);
            }
            
            const remainingGridCash = Math.max(0, freeCash - (marketLots * currentPrice * lotSize));
            
            const candles = state.chartData?.['1m'] || [];
            const natrRaw = calculateNATR(candles, 14, 50);
            const adxRaw = calculateADX(candles, 14);
            const trendScale = adxRaw > 30 ? 1.3 : (adxRaw > 20 ? 1.1 : 0.9);
            const natrClamped = Math.max(0.7, Math.min(1.5, natrRaw)) * trendScale;
            
            const limitDown = state.orderBook?.limitDown || 0;
            const minAllowedFloor = limitDown > 0 ? limitDown * 1.0005 : currentPrice * 0.85;
            const hardFloor = Math.max(currentPrice * 0.85, minAllowedFloor);
            
            let step = 0.005 * natrClamped;
            if ((0.998 - 9 * step) * currentPrice < hardFloor) {
                step = Math.max(0, ( currentPrice * 0.998 - hardFloor ) / (9 * currentPrice));
            }
            
            const fibWeights = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55];
            const fractions = fibWeights.map(w => w / 143); 
            const levels = Array.from({length: 10}, (_, i) => 0.998 - (i * step)); 
            
            let accumulatedCash = 0;
            const buyOrdersMap = new Map<number, { qty: number, reason: string }>();
            const tickSize = state.instrumentDetails?.minPriceIncrement || 0.01;

            for (let i = 0; i < 10; i++) {
                if (!this.kernel.getState().isBotActive) break; // Dead-man short-circuit
                
                accumulatedCash += remainingGridCash * fractions[i];
                let levelPrice = currentPrice * levels[i];
                
                levelPrice = Math.min(levelPrice, currentPrice * 0.998);
                levelPrice = Math.max(levelPrice, hardFloor);
                
                const limitLots = Math.floor(accumulatedCash / (levelPrice * lotSize));
                if (limitLots > 0) {
                    const finalPrice = roundPriceToTick(levelPrice, tickSize);
                    if (buyOrdersMap.has(finalPrice)) {
                        const existing = buyOrdersMap.get(finalPrice)!;
                        existing.qty += limitLots;
                        existing.reason += `+${i+1}`;
                    } else {
                        buyOrdersMap.set(finalPrice, { qty: limitLots, reason: `BUY_GRID_${i+1}` });
                    }
                    accumulatedCash -= limitLots * levelPrice * lotSize;
                }
            }

            const promises = [];
            for (const [price, info] of buyOrdersMap.entries()) {
                promises.push(
                    this.executeOrder(figi, info.qty, TradeDirection.BUY, price, { reason: info.reason }, tickSize)
                        .catch((e: any) => this.kernel.log(LogType.WARNING, `⚠️ Не удалось выставить ${info.reason}: ${e.message}`))
                );
            }
            await Promise.allSettled(promises);
        } else {
            this.kernel.log(LogType.INFO, `🛡️ VORTEX: Активная позиция ${(assetWeight*100).toFixed(1)}%. Расстановка глубокой защитной сетки...`);
            
            const baseRefPrice = currentPrice;
            const candles = state.chartData?.['1m'] || [];
            const natrRaw = calculateNATR(candles, 14, 50);
            const adxRaw = calculateADX(candles, 14);
            const trendScale = adxRaw > 30 ? 1.3 : (adxRaw > 20 ? 1.1 : 0.9);
            const natrClamped = Math.max(0.5, Math.min(2.0, natrRaw)) * trendScale; 
            
            const weightRatio = assetWeight > targetWeight ? (assetWeight / targetWeight) : 1;
            const scaleFactor = Math.min(weightRatio, 3.0) * natrClamped; 
            
            if (natrClamped > 1.2) {
                this.kernel.log(LogType.WARNING, `🌪️ ВЫСОКАЯ ВОЛАТИЛЬНОСТЬ/ТРЕНД (NATR: ${natrClamped.toFixed(2)}x, ADX: ${adxRaw.toFixed(1)}). Сетка расширена.`);
            } else if (natrClamped < 0.8) {
                this.kernel.log(LogType.INFO, `🍃 ШТИЛЬ (NATR: ${natrClamped.toFixed(2)}x, ADX: ${adxRaw.toFixed(1)}). Сетка сужена.`);
            }
            
            const limitDown = state.orderBook?.limitDown || 0;
            const minAllowedFloor = limitDown > 0 ? limitDown * 1.0005 : baseRefPrice * 0.60;
            const hardFloor = Math.max(baseRefPrice * 0.60, minAllowedFloor); 
            
            let step = 0.005 * natrClamped * scaleFactor; 
            if ((0.998 - 9 * step) * baseRefPrice < hardFloor) {
                step = Math.max(0, ( baseRefPrice * 0.998 - hardFloor ) / (9 * baseRefPrice));
            }
            
            const fibWeights = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55];
            const fractions = fibWeights.map(w => w / 143); 
            const levels = Array.from({length: 10}, (_, i) => 0.998 - (i * step)); 
            
            let accumulatedCash = 0;
            const defBuyOrdersMap = new Map<number, { qty: number, reason: string }>();
            const tickSize = state.instrumentDetails?.minPriceIncrement || 0.01;

            for (let i = 0; i < 10; i++) {
                if (!this.kernel.getState().isBotActive) break; // Dead-man short-circuit
                
                accumulatedCash += freeCash * fractions[i];
                let levelPrice = baseRefPrice * levels[i];
                
                levelPrice = Math.min(levelPrice, baseRefPrice * 0.998);
                levelPrice = Math.max(levelPrice, hardFloor);
                
                const limitLots = Math.floor(accumulatedCash / (levelPrice * lotSize));
                if (limitLots > 0) {
                    const finalPrice = roundPriceToTick(levelPrice, tickSize);
                    if (defBuyOrdersMap.has(finalPrice)) {
                        const existing = defBuyOrdersMap.get(finalPrice)!;
                        existing.qty += limitLots;
                        existing.reason += `+${i+1}`;
                    } else {
                        defBuyOrdersMap.set(finalPrice, { qty: limitLots, reason: `BUY_DEFENSIVE_GRID_${i+1}` });
                    }
                    accumulatedCash -= limitLots * levelPrice * lotSize;
                }
            }

            const promises = [];
            for (const [price, info] of defBuyOrdersMap.entries()) {
                promises.push(
                    this.executeOrder(figi, info.qty, TradeDirection.BUY, price, { reason: info.reason }, tickSize)
                        .catch((e: any) => this.kernel.log(LogType.WARNING, `⚠️ Не удалось выставить ${info.reason}: ${e.message}`))
                );
            }
            await Promise.allSettled(promises);
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

        // TITAN-GUARD: Block execution if bot is stopped
        if (!state.isBotActive) {
            this.kernel.log(LogType.WARNING, "🛡️ DEAD-MAN SWITCH: Блокировка транзакции (Система остановлена).");
            return;
        }

        // TITAN-GUARD: Block execution if the instrument was hot-swapped during an async loop
        const isMainFigi = state.instrumentDetails?.figi === figi;
        const isLiquidityFund = figi === state.ammCapitalState?.liquidityFundFigi || figi === 'TCS00A1010H1' /* Legacy TMON */ || figi === 'TCS00A104TS6' /* LQDT */ || figi === 'TCS00A105P80' /* TMON@ */ || figi === 'TCS00A1061C4' /* TMON NEW */ || (state as any).liquidityFundFigi === figi;
        
        if (!isMainFigi && !isLiquidityFund) {
            this.kernel.log(LogType.WARNING, `🛡️ DEAD-MAN SWITCH: Блокировка транзакции (Смена инструмента в процессе: ${figi}).`);
            return;
        }

        if (lots <= 0) return;
        
        let finalPrice = limitPrice || 0;

        // --- TICK ALIGNMENT (CRITICAL) ---
        if (finalPrice > 0) {
            finalPrice = roundPriceToTick(finalPrice, minIncrement);
        }

        // --- CENTRALIZED IDEMPOTENCY ---
        // V4.0 Stable Key: Uses accurate timestamp. Ensures that if a grid is canceled and rebuilt quickly,
        // Tinkoff doesn't return a "Zombie Canceled" order due to idempotency key collisions.
        // MAX LENGTH 36 CHARACTERS!
        const dirCode = direction === TradeDirection.BUY ? 'B' : 'S';
        const res = (metadata?.reason || 'SYS').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6);
        const shortFigi = figi.slice(-6);
        const ts36 = Date.now().toString(36);
        const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        
        const finalIdempotencyKey = idempotencyKey || `${dirCode}-${shortFigi}-${res}-${ts36}-${rand}`; 
        // e.g. "S-107UL4-TP1VOR-lxw9v2lq-123" (28 chars)


        // --- CASH CHECK (OPTIMIZED: Use State) ---
        if (direction === TradeDirection.BUY) {
            try {
                // VORTEX STRICT CHECK
                const power = state.effectiveBuyingPower || 0;
                const lotSize = state.instrumentDetails?.lot || 1;
                
                let checkPrice = finalPrice;
                if (checkPrice === 0) {
                     checkPrice = state.lastTrades?.[0]?.price || state.chartData?.['1m']?.slice(-1)[0]?.price || state.position?.entryPrice || 0;
                }
                
                if (checkPrice <= 0) {
                    this.kernel.log(LogType.ERROR, `🛡️ VORTEX GUARD: Блокировка BUY-ордера. Невозможно определить текущую цену актива (checkPrice = 0).`);
                    return; // Prevent blind market orders!
                }
                
                const estimatedCost = checkPrice * lots * lotSize;
                
                if (estimatedCost > power * 1.05) { // 5% buffer for market
                    const msg = `⚠️ ОТКЛОНЕНО (Недостаточно средств): Ордер ${lots} лотов (Cost: ~${estimatedCost.toFixed(2)}) > Бюджет (${power.toFixed(2)}).`;
                    this.kernel.log(LogType.WARNING, msg);
                    return; // Prevent execution!!
                }
            } catch (e: any) {
                this.kernel.log(LogType.WARNING, `⚠️ Cash check skipped/failed: ${e.message}`);
            }
        }

        const tempId = `optimistic-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        const optimisticOrder: GridOrder = {
            orderId: tempId,
            status: 'OPTIMISTIC',
            qty: lots,
            price: finalPrice,
            direction: direction,
            createdAt: Date.now(),
            metadata: metadata
        };
        
        // TITAN-IRONCLAD: Safe Atomic Placement
        this.kernel.updateState((prev) => {
            const newOrders = [...(prev.activeGridOrders || []), optimisticOrder];
            const fallbackMode = !prev.marginAttributes || prev.marginAttributes.isFallback;
            const locked = capitalService.calculateLockedFunds(newOrders, prev.instrumentDetails || null, fallbackMode);
            const power = capitalService.calculateEffectiveBuyingPower(prev.marginAttributes || null, prev.instrumentDetails || null, prev.account?.balance || 0, locked);
            return {
                activeGridOrders: newOrders,
                effectiveBuyingPower: power
            };
        }, false);

        try {
            debugService.logTrace('ExecuteOrder', 'SENDING', { figi, lots, direction, price: finalPrice, orderId: tempId });

            let apiOrderId: string;
            
            if (finalPrice > 0) {
                apiOrderId = await tInvestService.placeOrder(figi, lots, direction, 'LIMIT', finalPrice, tempId, tickSize, finalIdempotencyKey);
            } else {
                apiOrderId = await tInvestService.placeOrder(figi, lots, direction, 'MARKET', undefined, tempId, tickSize, finalIdempotencyKey);
            }
            
            // TITAN-IRONCLAD: Safe Atomic ID Swap
            this.kernel.updateState((prev) => ({
                activeGridOrders: (prev.activeGridOrders || []).map(o => 
                    o.orderId === tempId ? { ...o, orderId: apiOrderId, lastUpdateTime: Date.now() } : o
                )
            }), false);
            
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

            // TITAN-IRONCLAD: Safe Atomic Rollback
            this.kernel.updateState((prev) => {
                const newOrders = (prev.activeGridOrders || []).filter(o => o.orderId !== tempId);
                const fallbackMode = !prev.marginAttributes || prev.marginAttributes.isFallback;
                const locked = capitalService.calculateLockedFunds(newOrders, prev.instrumentDetails || null, fallbackMode);
                const power = capitalService.calculateEffectiveBuyingPower(prev.marginAttributes || null, prev.instrumentDetails || null, prev.account?.balance || 0, locked);
                return {
                    activeGridOrders: newOrders,
                    effectiveBuyingPower: power
                };
            }, false);
            
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
