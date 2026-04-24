
import { BotKernel } from '../bot-kernel';
import { LogType, TradeDirection, GridOrder, PositionStatus, TradeHistoryEntry } from '../../types';
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
    private inFlightOrders: Map<string, number> = new Map(); // ГЛОБАЛЬНАЯ ЗАЩИТА: lockKey -> timestamp
    private pendingExecutionIds: Set<string> = new Set();
    private logThrottles = new Map<string, number>();
    private lastActionTime = 0; 
    private lastGridPrice = 0;
    private currentRegime: 'TREND_UP' | 'TREND_DOWN' | 'FLAT' = 'FLAT';
    private adaptiveBasePrice: number = 0;
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
        // Schrodinger check
        const hasUnknown = (this.kernel.getState().activeGridOrders || []).some(o => o.status === 'UNKNOWN');
        if (hasUnknown) {
             this.kernel.log(LogType.WARNING, "⚠️ ПРОТОКОЛ ШРЁДИНГЕРА: Блокировка перестроения, ожидание разрешения UNKNOWN ордеров.");
             return;
        }

        if (!this.isBotRunning()) return;
        
        // ВНИМАНИЕ: Не блокируем обновление стейта через isExecutionInProgress, 
        // иначе мы ПРОПУСТИМ событие исполнения ордера, что приведет к рассинхронизации PnL и зависанию сетки!

        try {
            const msgObj = event.isPartial ? "ЧАСТИЧНОЕ ИСПОЛНЕНИЕ" : "ПОЛНОЕ ИСПОЛНЕНИЕ";
            this.kernel.log(LogType.SUCCESS, `⚡ ${msgObj}: ${event.direction} ${event.quantity} шт. @ ${event.price.toFixed(2)}`);

            this.kernel.updateState(prev => {
                const pos = prev.position;
                let newQty = 0;
                let newEntryPrice = 0;

                if (pos) {
                    newQty = pos.currentQuantity;
                    newEntryPrice = pos.entryPrice;
                }

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
                
                const updatedPosition = pos ? { ...pos, currentQuantity: newQty, entryPrice: newEntryPrice } : {
                    figi: prev.instrumentDetails?.figi || '',
                    quantity: newQty,
                    initialQuantity: newQty,
                    currentQuantity: newQty,
                    entryPrice: newEntryPrice,
                    direction: TradeDirection.BUY,
                    status: PositionStatus.FULL,
                    pnl: 0
                };

                const effectivePower = prev.effectiveBuyingPower || 0;
                const cost = event.quantity * event.price * (prev.instrumentDetails?.lot || 1);
                const newPower = event.direction === TradeDirection.BUY || (event.direction as any) === 'ORDER_DIRECTION_BUY'
                    ? Math.max(0, effectivePower - cost)
                    : effectivePower + cost;

                const newTrade: TradeHistoryEntry = {
                    id: event.orderId + '-' + Date.now(),
                    type: 'TRADE',
                    pnl: 0,
                    outcome: 'Neutral',
                    decisionReason: event.isPartial ? 'Stream Partial Fill' : 'Stream Full Fill',
                    exitTime: Date.now(),
                    entryPrice: event.price,
                    exitPrice: event.price,
                    quantity: event.quantity,
                    volume: event.quantity * event.price
                };

                return {
                    position: newQty > 0 ? updatedPosition : undefined,
                    effectiveBuyingPower: newPower,
                    tradeHistory: [newTrade, ...(prev.tradeHistory || [])].slice(0, 500),
                    activeGridOrders: event.isPartial 
                        ? prev.activeGridOrders // Don't remove order from active grid yet if partial
                        : (prev.activeGridOrders || []).filter(o => o.orderId !== event.orderId)
                };
            }, false);

            
            // --- FULL REBUILD LOGIC & COOLDOWN (Anti-Spam) ---
            if (event.isPartial) {
                if (this.firstPartialFillTime === 0) {
                    this.firstPartialFillTime = Date.now();
                    this.kernel.log(LogType.INFO, `⏳ Start 5-min cooldown for Partial Fills...`);
                }
                
                const timeSinceFirstPartial = Date.now() - this.firstPartialFillTime;
                if (timeSinceFirstPartial < 5 * 60 * 1000) {
                    this.kernel.log(LogType.INFO, `⏳ Grid rebuild deferred (Partial Fill Cooldown).`);
                    return; // Skip rebuilding
                } else {
                    this.firstPartialFillTime = 0; // reset
                }
            } else {
                this.firstPartialFillTime = 0; // Full fill resets partial fill timer
            }

            await this.processAdaptiveTTech(true);

        } catch (e: any) {
            this.kernel.log(LogType.ERROR, `Ошибка обновления после исполнения: ${e.message}`);
        }
    }

    public async syncAMMGrid(virtualOrders: import('../../types').VirtualOrder[], activeOrders: GridOrder[], figi: string) {
        // Schrodinger check
        const hasUnknown = activeOrders.some(o => o.status === 'UNKNOWN');
        if (hasUnknown) {
             if (this.shouldLog('schrodinger_sync', 5000)) {
                 this.kernel.log(LogType.WARNING, "⚠️ ПРОТОКОЛ ШРЁДИНГЕРА: Блокировка синхронизации AMM, ожидание разрешения UNKNOWN ордеров.");
             }
             return;
        }

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
            const state = this.kernel.getState();
            const figi = state.instrumentDetails?.figi;
            if (!figi) return;

            // --- SOURCE OF TRUTH CONSOLIDATION ---
            const exchangeOrders = await tInvestService.getActiveOrders(figi);
            const memoryOrders = state.activeGridOrders || [];
            
            // Объединяем: то что есть на бирже + то что мы только что отправили (Latency Gap Bridging)
            // Защита от двойных ордеров: учитываем не только "optimistic-", но и недавно созданные реальные ордера,
            // которые TInvest еще не успел реплицировать в ответ getActiveOrders (REST API задержка).
            const activeOrders = [...exchangeOrders];
            const exchangeIds = new Set(exchangeOrders.map(o => o.orderId));
            const now = Date.now();
            
            for (const mo of memoryOrders) {
                if (!exchangeIds.has(mo.orderId) && (now - mo.createdAt < 35000)) {
                    activeOrders.push(mo);
                }
            }

            const tickSize = state.instrumentDetails?.minPriceIncrement || 0.01;

            // 1. ОТМЕНА НЕНУЖНЫХ (Освобождаем кэш/маржу ПЕРЕД постановкой новых)
            const vMatched = new Set<number>(); // Индексы совпавших виртуальных ордеров
            
            // Сначала проходим по всем текущим ордерам (и с биржи, и "летящим" из памяти)
            for (const active of activeOrders) {
                // Ищем соответствующий виртуальный ордер, который еще не "занят"
                const vIndex = virtualOrders.findIndex((v, idx) => 
                    !vMatched.has(idx) &&
                    Math.abs(active.price - v.price) < (tickSize * 0.1) && 
                    active.direction === v.direction && 
                    Math.abs(active.qty - v.volume) < 0.001
                );

                if (vIndex !== -1) {
                    vMatched.add(vIndex); // Этот виртуальный ордер "покрыт" активным
                } else {
                    // Если ордер не нужен, отменяем его.
                    // Отменяем только те, что физически подтверждены биржей (в exchangeOrders), 
                    // чтобы не спамить API ошибками "Not Found" по зависшим в Latency Gap.
                    if (exchangeIds.has(active.orderId)) {
                        this.kernel.log(LogType.INFO, `➖ SYNC: Снимаю лишний ордер: ${active.orderId} @ ${active.price}`);
                        try {
                            await tInvestService.cancelOrder(active.orderId);
                            this.kernel.updateState((prev) => ({
                                activeGridOrders: (prev.activeGridOrders || []).filter(o => o.orderId !== active.orderId)
                            }), false);
                        } catch (e: any) {
                            this.kernel.log(LogType.WARNING, `⚠️ Ошибка отмены ${active.orderId}: ${e.message}`);
                        }
                    }
                }
            }

            // 2. ВЫСТАВЛЕНИЕ НЕДОСТАЮЩИХ (Только то, что не было покрыто в фазе 1)
            for (let idx = 0; idx < virtualOrders.length; idx++) {
                if (!vMatched.has(idx)) {
                    const vOrder = virtualOrders[idx];
                    this.kernel.log(LogType.INFO, `➕ SYNC: Ставлю: ${vOrder.direction} ${vOrder.volume} @ ${vOrder.price}`);
                    try {
                        // Генерируем уникальный ключ идемпотентности, чтобы избежать ошибки Tinkoff:
                        // "The order is a duplicate, but the order report was not found" при перестановках.
                        const stableKey = vOrder.idempotencyKey || `TITAN-${vOrder.direction}-${vOrder.price.toFixed(2)}-${Date.now()}`;
                        await this.executeOrder(figi, vOrder.volume, vOrder.direction, vOrder.price, vOrder.metadata, tickSize, stableKey);
                    } catch (e: any) {
                        this.kernel.log(LogType.ERROR, `[!] SYNC: Ошибка выставления: ${e.message}`);
                    }
                }
            }

            // 3. ОЧИСТКА ПАМЯТИ (Anti-Zombies)
            // Удаляем из стейта ордера, которых уже нет на бирже (исполнены или отменены вне стрима), 
            // и которые старше 35 секунд (вышли из Latency Gap).
            this.kernel.updateState((prev) => {
                const cleanedOrders = (prev.activeGridOrders || []).filter(o => 
                    exchangeIds.has(o.orderId) || (now - o.createdAt < 35000)
                );
                return { activeGridOrders: cleanedOrders };
            }, false);

        } finally {
            this.isExecutionInProgress = false;
        }
    }

    public async processAdaptiveTTech(force: boolean = false) {
        // A-007 Hard-Guard
        if (!this.isReady) {
            if (this.shouldLog('locked_start', 5000)) {
                this.kernel.log(LogType.WARNING, "⚠️ ORDER-CONTROLLER: Блокировка операций (Ожидание инициализации)...");
            }
            return;
        }

        // Schrodinger check
        const hasUnknown = (this.kernel.getState().activeGridOrders || []).some(o => o.status === 'UNKNOWN');
        if (hasUnknown) {
             if (this.shouldLog('schrodinger_ttech', 5000)) {
                 this.kernel.log(LogType.WARNING, "⚠️ ПРОТОКОЛ ШРЁДИНГЕРА: Блокировка T-TECH (Построение сетки), ожидание разрешения UNKNOWN ордеров.");
             }
             return;
        }

        // BLOCKING GUARD (PHASE 15)
        if (this.isExecutionInProgress || this.kernel.isSynchronizing) return;

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
            
            // Защита от старта до синхронизации (чтобы не генерировать ложные сетки)
            if (this.shouldLog('wait_pos', 5000) && position === null) {
                this.kernel.log(LogType.INFO, "⚠️ T-TECH: Ожидание полной синхронизации позиции...");
            }
            if (position === null) return; 

            // 1. ПРОАКТИВНЫЙ ВХОД (ДОБОР ДО 30%)
            const lotSize = instrumentDetails.lot || 1;
            const totalCapital = ammCapitalState.totalCapitalValue;
            const targetEntryValue = totalCapital * 0.3; // Цель - 30% капитала в активе
            const currentAssetValue = realQty * currentPrice * lotSize;

            // Если актива нет, либо мы сильно разбалансированы (текущий объем менее 70% от целевых 30%)
            // Это актуально при первом запуске с "объедками" на балансе, либо при доливе нового кэша.
            if (currentAssetValue < targetEntryValue * 0.70) {
                // Ищем ордера добора (ближе 1% от текущей цены)
                const pendingProactive = (state.activeGridOrders || []).filter(o => 
                    o.direction === TradeDirection.BUY && 
                    o.status === 'PENDING' &&
                    o.price >= currentPrice * 0.99
                ).length;

                if (pendingProactive > 0) {
                    if (this.shouldLog('wait_entry', 30000)) {
                        this.kernel.log(LogType.INFO, `⏳ T-TECH: Ожидание исполнения проактивного входа (Ордеров в пути: ${pendingProactive})...`);
                    }
                    return; 
                }

                // Отменяем старые сетки, чтобы высвободить замороженный кэш для добора
                const pendingGridBuys = (state.activeGridOrders || []).filter(o => 
                    o.direction === TradeDirection.BUY && 
                    o.status === 'PENDING' &&
                    o.price < currentPrice * 0.99
                );
                
                if (pendingGridBuys.length > 0) {
                    this.kernel.log(LogType.INFO, `🧹 T-TECH: Отмена старой сетки покупок для приоритетного входа...`);
                    this.isExecutionInProgress = true;
                    try {
                        for (const o of pendingGridBuys) {
                            await tInvestService.cancelOrder(o.orderId);
                        }
                        const remainingIds = (state.activeGridOrders || []).filter(o => !pendingGridBuys.some(gb => gb.orderId === o.orderId));
                        this.kernel.updateState({ activeGridOrders: remainingIds }, false);
                    } catch (e: any) {
                        this.kernel.log(LogType.ERROR, `Ошибка отмены сетки: ${e.message}`);
                    }
                    this.isExecutionInProgress = false;
                    return; // Ждем следующего тика, когда деньги вернутся на счет после отмены
                }

                const fiatToBuy = targetEntryValue - currentAssetValue;
                const lotsToBuy = Math.floor(fiatToBuy / (currentPrice * lotSize));

                if (lotsToBuy > 0) {
                    this.kernel.log(LogType.INFO, `🎯 T-TECH: Добор актива до 30% фонда (Покупка ${lotsToBuy} лотов)...`);
                    this.isExecutionInProgress = true;
                    try {
                        const tickSize = instrumentDetails.minPriceIncrement || 0.01;
                        const safeLimitPrice = currentPrice + (tickSize * 2); // Эмуляция маркета через лимит

                        await this.executeOrder(instrumentDetails.figi, lotsToBuy, TradeDirection.BUY, safeLimitPrice, { reason: 'PROACTIVE_ENTRY_30' });
                        this.kernel.log(LogType.SUCCESS, `✅ T-TECH: Команда на вход отправлена.`);
                        this.adaptiveBasePrice = currentPrice; 
                    } catch (ordersError: unknown) {
                        this.kernel.log(LogType.ERROR, `Ошибка при проактивном входе: ${(ordersError as Error).message}`);
                    }
                    this.isExecutionInProgress = false;
                    return; 
                }
            }

            // --- T-TECH ФАЗА 3: РАСЧЕТ ИНДИКАТОРОВ И РЕЖИМА ---
            const dailyCandles = chartData['1d'] || []; // Используем 1d свечи для трендовых индикаторов
            if (dailyCandles.length < 65) { // Нужно минимум 64 свечи для nATR (atr14 + sma50)
                if (this.shouldLog('err_candles', 60000)) {
                    this.kernel.log(LogType.WARNING, `⚠️ T-TECH: Ожидание накопления свечей D1 (доступно: ${dailyCandles.length}/65).`);
                }
                return; 
            }

            const apz = calculateAPZ(dailyCandles, 20);
            const nATR = calculateNATR(dailyCandles, 14, 50);
            const donchian = calculateDonchianChannels(dailyCandles, 20);

            this.kernel.updateState({
                currentAnalysis: {
                    apzUpper: apz.upper,
                    apzLower: apz.lower,
                    nATR: nATR,
                    donchianUpper: donchian.upper,
                    donchianLower: donchian.lower
                }
            }, false);

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
                    // A-005: Плавное подтягивание базы во флете
                    this.adaptiveBasePrice = (this.adaptiveBasePrice * 0.999) + (currentPrice * 0.001);
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
            // ВАЖНО: Добавляем обратно кэш, уже заблокированный в текущей buy-сетке,
            // иначе генератор сетки будет уменьшать размеры лотов на каждом тике!
            const lockedCash = capitalService.calculateLockedFunds(state.activeGridOrders, instrumentDetails);
            const totalCapitalForGrid = state.effectiveBuyingPower + lockedCash; 
            
            const virtualOrders = calculateAdaptiveTTechGrid(
                this.adaptiveBasePrice,
                avgPrice,
                realQty,
                totalCapitalForGrid,
                instrumentDetails,
                apz,
                nATR
            );

            // Синхронизация с реальным рынком (Buy + Sell)
            // A-006: Защита от начала синхронизации в процессе исполнения
            if (this.kernel.isSynchronizing) {
                this.kernel.log(LogType.WARNING, "⚠️ T-TECH: Начата внешняя синхронизация, прерываю цикл адаптации.");
                return;
            }
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
        metadata?: GridOrder['metadata'],
        tickSize: number = 0.01,
        idempotencyKey?: string
    ) {
        const state = this.kernel.getState();
        
        // STRICT GUARD (PHASE 16): BLOCK ALL EXECUTION DURING SYNC
        if (this.kernel.isSynchronizing) {
            this.kernel.log(LogType.WARNING, "🛡️ GRID GUARD: Блокировка транзакции (Идет синхронизация).");
            return;
        }

        if (lots <= 0) return;
        
        let finalPrice = limitPrice || 0;

        // --- TICK ALIGNMENT (CRITICAL) ---
        if (finalPrice > 0) {
            finalPrice = roundPriceToTick(finalPrice, tickSize);
        }

        // --- CENTRALIZED IDEMPOTENCY ---
        // Идемпотентность нужна ТОЛЬКО на уровне сетевого запроса к Tinkoff. 
        // Важно, чтобы при выставлении НОВОГО ордера на том же самом уровне, ключ отличался от старого.
        const finalIdempotencyKey = idempotencyKey || `TITAN-${direction}-${finalPrice.toFixed(2)}-${Date.now()}`;


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
