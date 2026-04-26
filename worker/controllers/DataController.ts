
import type { BotKernel } from '../bot-kernel';
import { LogType, KernelStatus, ConnectionStatus, BotStatus, GridOrder } from '../../types';
import { TARGET_INSTRUMENT } from '../../constants';
import * as marketDataService from '../../services/marketDataService';
import { streamManager } from '../../services/streamManager';
import * as tInvestService from '../../services/tInvestService'; 
import * as capitalService from '../../services/capitalService'; 
import { isMarketOpenNow } from '../../utils/marketTime';

export class DataController {
    constructor(private kernel: BotKernel) {
        this.bindEvents();
    }

    private isProcessingTrades = false;

    private bindEvents() {
        // ... все остальные методы ...

        // --- 3. TRADES STREAM ---
        streamManager.on('trades', async (data: any) => {
            this.isProcessingTrades = true;
            const { trades, figi } = data;
            const state = this.kernel.getState();
            const currentFigi = state.instrumentDetails?.figi;
            
            if (currentFigi && figi !== currentFigi) {
                this.kernel.log(LogType.WARNING, `⚠️ Игнорирование сделок для ${figi}`, 'DataController', { receivedFigi: figi, expectedFigi: currentFigi });
                this.isProcessingTrades = false;
                return;
            }
            
            const combined = [...trades, ...state.lastTrades];
            const newTrades = combined
                .sort((a, b) => b.time - a.time) 
                .slice(0, 50); 
            
            this.kernel.updateState({ lastTrades: newTrades }, true);
            this.isProcessingTrades = false;
        });

        // --- 4. PORTFOLIO STREAM ---
        streamManager.on('portfolio', async (data: any) => {
            // Ожидаем завершения обработки сделок (макс. 500мс)
            let waitLimit = 0;
            while(this.isProcessingTrades && waitLimit < 5) {
                await new Promise(r => setTimeout(r, 100));
                waitLimit++;
            }

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
                grossCash = margin.fundsForBuy;
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
                    const totalLiquidity = margin ? margin.liquidPortfolio : account.balance;
                    const ammCapitalState = capitalService.calculateAmmCapitalAllocation(
                        grossCash,
                        realQty,
                        currentPrice,
                        lotSize
                    );
                    ammCapitalState.totalCapitalValue = totalLiquidity;
                    ammCapitalState.liquidityFundValue = liquidityFundValue;
                    this.kernel.updateState({ ammCapitalState }, false);
                }
            }

            const globalLockedFunds = capitalService.calculateLockedFunds(currentState.activeGridOrders, currentState.instrumentDetails);
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
                o.status === 'PENDING' && 
                !streamIds.has(o.orderId) &&
                (now - o.createdAt < 30000) // Увеличили окно с 20с до 30с для надежности
            );
            
            const mergedOrders = [...streamOrders, ...preservedOptimistic];
            this.kernel.updateState({ activeGridOrders: mergedOrders }, false); 
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
            const liquidityFundFigi = liquidityFundDetails ? liquidityFundDetails.figi : null;

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
                            lotSize
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
            const account = await tInvestService.getAccount();
            const figi = state.instrumentDetails?.figi;
            
            const [margin, history, positionFetched] = await Promise.all([
                tInvestService.getMarginAttributes(account),
                tInvestService.fetchOperationalHistory(),
                figi ? tInvestService.getPosition(figi) : Promise.resolve(null)
            ]);
            
            const locked = capitalService.calculateLockedFunds(state.activeGridOrders, state.instrumentDetails);
            const power = capitalService.calculateEffectiveBuyingPower(margin, state.instrumentDetails, account.balance, locked);
            
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
                account, 
                effectiveBuyingPower: power,
                position: position,
                tradeHistory: history.slice(-50) // Keep last 50 to prevent memory leak
            }, true);
        } catch(e) {
            console.warn("Margin Sync Failed:", e);
        }
    }

    public async syncTradeHistory(): Promise<number> {
        try {
            const history = await tInvestService.fetchOperationalHistory();
            this.kernel.updateState({ tradeHistory: history.slice(-50) }, true);
            return history.length;
        } catch(e) {
            console.warn("Trade History Sync Failed:", e);
            return 0;
        }
    }
}
