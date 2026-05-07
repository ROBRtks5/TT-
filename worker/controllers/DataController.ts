
import type { BotKernel } from '../bot-kernel';
import { LogType, KernelStatus, ConnectionStatus, BotStatus, GridOrder } from '../../types';
import { TARGET_INSTRUMENT } from '../../constants';
import * as marketDataService from '../../services/marketDataService';
import { streamManager } from '../../services/streamManager';
import * as tInvestService from '../../services/tInvestService'; 
import * as capitalService from '../../services/capitalService'; 
import * as mathStrategyService from '../../services/mathStrategyService';
import { isMarketOpenNow } from '../../utils/marketTime';

export class DataController {
    constructor(private kernel: BotKernel) {
        this.bindEvents();
    }

    private isProcessingTrades = false;

    private bindEvents() {
        // --- 1. CANDLE STREAM ---
        streamManager.on('candle', (data: any) => {
            const { interval, candle, all, figi } = data;
            const state = this.kernel.getState();
            
            const currentFigi = state.instrumentDetails?.figi;
            if (figi && currentFigi && currentFigi !== figi) return;

            const chartData = { ...state.chartData };
            const existing = chartData[interval as keyof typeof chartData] || [];
            
            // Merge `all` into `existing` efficiently to preserve bootstrap history
            const mergedMap = new Map();
            for (const c of existing) mergedMap.set(c.time, c);
            for (const c of all) mergedMap.set(c.time, c);
            
            const merged = Array.from(mergedMap.values()).sort((a, b) => a.time - b.time);
            
            // Cap memory (1440 candles = 24 hours of 1m)
            const finalCandles = merged.slice(-1500);
            chartData[interval as keyof typeof chartData] = finalCandles;
            
            if (interval === '1m') {
                const rsi = mathStrategyService.calculateRSI(finalCandles, 14);
                const adx = mathStrategyService.calculateADX(finalCandles, 14);
                const phase = mathStrategyService.determineMarketPhase(rsi, adx);
                let driver = 'NONE';
                if (adx > 25) driver = 'TREND';
                else if (adx > 15) driver = 'MOMENTUM';
                else driver = 'RANGE';

                this.kernel.updateState({ 
                    chartData,
                    telemetry: {
                        rsi: Number(rsi.toFixed(2)),
                        phase,
                        driver,
                        trendStrength: Number(adx.toFixed(2))
                    }
                }, true);
            } else {
                this.kernel.updateState({ chartData }, false);
            }
        });

        // --- 3. TRADES STREAM ---
        streamManager.on('trades', async (data: any) => {
            if (this.isProcessingTrades) return;
            this.isProcessingTrades = true;
            try {
                const { trades, figi } = data;
                const state = this.kernel.getState();
                const currentFigi = state.instrumentDetails?.figi;
                
                if (currentFigi && figi !== currentFigi) {
                    this.kernel.log(LogType.WARNING, `⚠️ Игнорирование сделок для ${figi}`, 'DataController', { receivedFigi: figi, expectedFigi: currentFigi });
                    return;
                }
                
                const combined = [...trades, ...state.lastTrades];
                
                // Deduplicate by composite key because LastTrade has no ID
                const uniqueMap = new Map();
                for (const t of combined) {
                    const uniqueId = `${t.time}-${t.price}-${t.quantity}-${t.direction}`;
                    if (!uniqueMap.has(uniqueId)) {
                        uniqueMap.set(uniqueId, t);
                    }
                }
                
                const newTrades = Array.from(uniqueMap.values())
                    .sort((a, b) => b.time - a.time) 
                    .slice(0, 50); 
                
                this.kernel.updateState({ lastTrades: newTrades }, true);
            } finally {
                this.isProcessingTrades = false;
            }
        });

        // --- 4. PORTFOLIO STREAM ---
        streamManager.on('portfolio', async (data: any) => {
            const { account, margin, position, rawPortfolio } = data;
            const currentState = this.kernel.getState();
            const instrument = currentState.instrumentDetails;

            // --- CHECK FOR LIQUIDITY FUNDS (TMON/LQDT) ---
            let liquidityFundValue = 0;
            if (rawPortfolio && rawPortfolio.positions) {
                // Commonly used funds for parking cash by the bot (e.g., TMON/LQDT in Tinkoff)
                const mmFunds = rawPortfolio.positions.filter((p: any) => 
                    p.figi === 'TCS00A1010H1' /* Legacy TMON */ || 
                    p.figi === 'TCS00A104TS6' /* LQDT */ || 
                    (currentState.liquidityFundFigi && p.figi === currentState.liquidityFundFigi)
                );
                mmFunds.forEach((p: any) => {
                    const price = p.currentPrice ? tInvestService.mapToNumber(p.currentPrice) : 0;
                    const qty = p.quantity ? tInvestService.mapToNumber(p.quantity) : 0;
                    liquidityFundValue += price * qty;
                });
            }

            // ==========================================
            // GLOBAL CASH RECONSTRUCTION (STRICT MODE)
            // ==========================================
            let grossCash = Math.max(0, account.balance);
            if (margin && margin.fundsForBuy !== undefined) {
                // TITAN PROTOCOL: Strictly prevent margin hallucination.
                if (margin.fundsForBuy < grossCash) {
                    grossCash = margin.fundsForBuy;
                }
            }
            const reliableAccount = { ...account, balance: grossCash };

            // --- AMM CAPITAL ALLOCATION ---
            if (instrument) {
                const lotSize = instrument.lot || 1;
                const realQty = position ? Math.abs(position.currentQuantity) : 0;
                let currentPrice = position ? position.entryPrice : 0;
                
                if (currentState.lastTrades && currentState.lastTrades.length > 0) {
                    currentPrice = currentState.lastTrades[0].price;
                } else if (currentState.chartData['1m'] && currentState.chartData['1m'].length > 0) {
                    currentPrice = currentState.chartData['1m'][currentState.chartData['1m'].length - 1].price;
                }
                
                if (currentPrice > 0) {
                    const ammCapitalState = capitalService.calculateAmmCapitalAllocation(
                        grossCash,
                        realQty,
                        currentPrice,
                        lotSize,
                        liquidityFundValue
                    );
                    this.kernel.updateState({ ammCapitalState }, false);
                }
            }

            const fallbackMode = !margin || margin.isFallback;
            const globalLockedFunds = capitalService.calculateLockedFunds(currentState.activeGridOrders, currentState.instrumentDetails, fallbackMode);
            const power = capitalService.calculateEffectiveBuyingPower(
                margin, 
                currentState.instrumentDetails, 
                reliableAccount.balance, 
                globalLockedFunds
            );

            this.kernel.updateState({
                account: reliableAccount,
                marginAttributes: margin,
                position,
                effectiveBuyingPower: power
            }, true);
        });

        // --- 4.5. ORDERS STREAM ---
        streamManager.on('orders', (streamOrders: GridOrder[]) => {
            const state = this.kernel.getState();
            const now = Date.now();
            
            const streamIds = new Set(streamOrders.map(o => o.orderId));
            
            // СВЕРКА: Какие ордера мы думали, что есть, а стрим их не видит?
            const localOrders = state.activeGridOrders || [];
            const missingInStream = localOrders.filter(o => !streamIds.has(o.orderId));
            
            if (missingInStream.length > 0) {
                 this.kernel.log(LogType.INFO, `🔍 [RECONCILIATION] ${missingInStream.length} ордеров в локальном стейте, но нет в биржевом стриме. Проверка оптимизма...`);
            }
            
            const preservedOptimistic = localOrders.filter(o => 
                (o.status === 'OPTIMISTIC' || o.status === 'UNKNOWN') && 
                !streamIds.has(o.orderId) &&
                (now - o.createdAt < 30000) // Увеличили окно с 20с до 30с для надежности
            );
            
            const mergedOrders = [...streamOrders, ...preservedOptimistic];
            
            // Recalculate buying power based on new activeGridOrders constraint
            const fallbackMode = !state.marginAttributes || state.marginAttributes.isFallback;
            const globalLockedFunds = capitalService.calculateLockedFunds(mergedOrders, state.instrumentDetails, fallbackMode);
            const power = capitalService.calculateEffectiveBuyingPower(
                state.marginAttributes || null, 
                state.instrumentDetails, 
                state.account?.balance || 0, 
                globalLockedFunds
            );
            
            this.kernel.updateState({ 
                activeGridOrders: mergedOrders,
                effectiveBuyingPower: power
            }, false); 
        });

        streamManager.on('log', (log: any) => {
            this.kernel.log(log.type, log.message);
        });

        streamManager.on('status', (status: string) => {
            let connStatus = ConnectionStatus.DISCONNECTED;
            if (status === 'CONNECTED') connStatus = ConnectionStatus.CONNECTED;
            if (status === 'CONNECTING') connStatus = ConnectionStatus.CONNECTING;
            if (status === 'RECONNECTING') connStatus = ConnectionStatus.RECONNECTING;
            
            const currentState = this.kernel.getState();
            this.kernel.updateState({ connectionStatus: connStatus }, true);
            
            if (status === 'CONNECTED') {
                this.kernel.log(LogType.SUCCESS, "📡 ПОТОК ДАННЫХ: АКТИВЕН (ADRENALINE)");
            } else if (status === 'DISCONNECTED') {
                this.kernel.log(LogType.WARNING, "📡 ПОТОК ДАННЫХ: РАЗОРВАН (Ожидание восстановления...)");
            } else if (status === 'RECONNECTING') {
                this.kernel.log(LogType.WARNING, "📡 ПОТОК ДАННЫХ: РЕКОННЕКТ...");
            }

            // CRITICAL FIX: Graceful Degradation instead of panic.
            // We no longer transition to STALE_DATA here. We stay in TRADING state.
            // The stream manager connects and disconnects autonomously while trading is preserved.
        });

        streamManager.on('reconnected', () => {
            const state = this.kernel.getState();
            this.forceMarginRefresh().catch(() => {});

            if (state.isBotActive) {
                this.kernel.log(LogType.WARNING, "♻️ ПОТОК ВОССТАНОВЛЕН. Запускаю принудительную сверку данных...");
                this.kernel.syncStateWithExchange().then(() => {
                    if (isMarketOpenNow()) {
                        this.kernel.log(LogType.SUCCESS, "✅ СИСТЕМА ВОССТАНОВЛЕНА. ВОЗВРАТ В РЕЖИМ ТОРГОВЛИ.");
                        this.kernel.updateState({ status: BotStatus.TRADING }, true);
                    }
                }).catch(err => {
                    this.kernel.log(LogType.ERROR, "Ошибка сверки после реконнекта: " + err.message);
                });
            }
        });

        streamManager.on('error', (err: any) => {
            this.kernel.updateState({ connectionStatus: ConnectionStatus.ERROR });
        });
    }

    public async initialize() {
        const state = this.kernel.getState();
        const requestedTicker = state.instrumentTicker || TARGET_INSTRUMENT; 
        
        this.kernel.log(LogType.SYSTEM, `⚡ Инициализация данных для ${requestedTicker}...`);
        
        try {
            streamManager.clearSubscriptions();

            this.kernel.updateKernelStatus(KernelStatus.RESOLVING_FIGI);
            
            const instrumentDetails = await tInvestService.resolveFigi(requestedTicker);
            
            // TITAN-IRONCLAD V2.1: Cache the correct liquidity fund figi at startup
            const liquidityFundDetails = await tInvestService.resolveFigi('TMON@', true);
            const liquidityFundFigi = liquidityFundDetails ? liquidityFundDetails.figi : undefined;

            const freshState = this.kernel.getState();
            if (freshState.instrumentTicker && freshState.instrumentTicker !== requestedTicker) {
                this.kernel.log(LogType.WARNING, `🛑 Инициализация отменена: Тикер изменен с ${requestedTicker} на ${freshState.instrumentTicker}`);
                return; 
            }

            this.kernel.updateState({ instrumentDetails, liquidityFundFigi });
            
            this.kernel.log(LogType.SUCCESS, `✅ FIGI найден: ${instrumentDetails.figi} (${instrumentDetails.name})`);

            await this.forceMarginRefresh(); 

            const chartData = await marketDataService.fetchBootstrapChartData(
                instrumentDetails,
                requestedTicker, 
                tInvestService, 
                (msg: string) => this.kernel.log(LogType.INFO, msg)
            );
            
            if (this.kernel.getState().instrumentTicker !== requestedTicker) return;

            this.kernel.updateState({ chartData });

            this.kernel.log(LogType.INFO, "⚡ SNAPSHOT: Запрос мгновенных данных...");
            try {
                const [trades, ob] = await Promise.all([
                    tInvestService.getLastTrades(instrumentDetails.figi, new Date(Date.now() - 300000), new Date()), 
                    tInvestService.getOrderBook(instrumentDetails.figi)
                ]);
                
                if (trades && trades.length > 0) {
                    this.kernel.updateState({ lastTrades: trades }, true); 
                }
                if (ob) {
                    this.kernel.updateState({ orderBook: ob }, false);
                }

                // Force AMM initialization immediately after getting snapshot data
                const freshStateForAmm = this.kernel.getState();
                if (instrumentDetails && freshStateForAmm.account) {
                    const lotSize = instrumentDetails.lot || 1;
                    const realQty = freshStateForAmm.position ? Math.abs(freshStateForAmm.position.currentQuantity) : 0;
                    let currentPrice = freshStateForAmm.position ? freshStateForAmm.position.entryPrice : 0;
                    
                    if (freshStateForAmm.lastTrades && freshStateForAmm.lastTrades.length > 0) {
                        currentPrice = freshStateForAmm.lastTrades[0].price;
                    } else if (freshStateForAmm.chartData['1m'] && freshStateForAmm.chartData['1m'].length > 0) {
                        currentPrice = freshStateForAmm.chartData['1m'][freshStateForAmm.chartData['1m'].length - 1].price;
                    }
                    
                    if (currentPrice > 0) {
                        const ammCapitalState = capitalService.calculateAmmCapitalAllocation(
                            freshStateForAmm.account.balance, 
                            realQty,
                            currentPrice,
                            lotSize,
                            freshStateForAmm.ammCapitalState?.liquidityFundValue || 0
                        );
                        this.kernel.updateState({ ammCapitalState }, false);
                    }
                }

            } catch(e) {}

            this.kernel.updateKernelStatus(KernelStatus.READY);

        } catch (e: any) {
            if (this.kernel.getState().instrumentTicker === requestedTicker) {
                this.kernel.log(LogType.ERROR, `ОШИБКА ИНИЦИАЛИЗАЦИИ ДАННЫХ (${requestedTicker}): ${e.message}. Повторная попытка через 10 секунд...`);
                // CRITICAL FIX: Do NOT destroy the kernel on temporary broker glitches.
                // this.kernel.updateKernelStatus(KernelStatus.FAILED);
                this.kernel.updateState({ status: BotStatus.ERROR }, true);
                
                // Autonomous retry loop
                setTimeout(() => {
                    if (!this.kernel.disposed && this.kernel.getState().isBotActive) {
                        this.kernel.log(LogType.SYSTEM, "🔄 АВТО-ВОССТАНОВЛЕНИЕ: Повторная инициализация данных...");
                        this.initialize().catch(() => {});
                    }
                }, 10000);
            } else {
                console.debug("Suppressing error for stale initialization.");
            }
            throw e; 
        }
    }

    public async forceMarginRefresh() {
        try {
            const state = this.kernel.getState();
            const figi = state.instrumentDetails?.figi;
            
            const portfolio = await tInvestService.getPortfolio();
            const account = await tInvestService.getAccount(portfolio);
            
            const [margin, positionFetched] = await Promise.all([
                tInvestService.getMarginAttributes(account),
                figi ? tInvestService.getPosition(figi, portfolio) : Promise.resolve(null)
            ]);
            
            // Fire and forget history sync to unblock margin resolution
            this.syncTradeHistory(1).catch(() => {});
            
            let grossCash = Math.max(0, account.balance);
            if (margin && margin.fundsForBuy !== undefined) {
                if (margin.fundsForBuy < grossCash) {
                    grossCash = margin.fundsForBuy;
                }
            }
            const reliableAccount = { ...account, balance: grossCash };
            
            const fallbackMode = !margin || margin.isFallback;
            const locked = capitalService.calculateLockedFunds(state.activeGridOrders, state.instrumentDetails, fallbackMode);
            const power = capitalService.calculateEffectiveBuyingPower(margin, state.instrumentDetails, reliableAccount.balance, locked);
            
            let position = state.position;
            if (figi) {
                if (positionFetched && Math.abs(positionFetched.currentQuantity) > 0) {
                     position = positionFetched;
                } else {
                     position = null;
                }
            }
            
            this.kernel.updateState({ 
                marginAttributes: margin, 
                account: reliableAccount, 
                effectiveBuyingPower: power,
                position: position
            }, true);
        } catch(e: any) {
            this.kernel.log(LogType.WARNING, `⚠️ Margin Sync Ошибка: ${e.message}`);
        }
    }

    public async syncTradeHistory(days: number = 7): Promise<number> {
        try {
            const history = await tInvestService.fetchOperationalHistory(days);
            this.kernel.updateState({ tradeHistory: history.slice(-50) }, true);
            return history.length;
        } catch(e: any) {
            this.kernel.log(LogType.WARNING, `⚠️ Trade History Sync Ошибка: ${e.message}`);
            return 0;
        }
    }
}
