
/**
 * TITAN TRADING BOT - T-INVEST SERVICE
 * ---------------------------------------------------------
 * @module services/tInvestService.ts
 * @version 14.40.0 (TICK PRECISION FIX)
 * ---------------------------------------------------------
 */

import {
    InstrumentDetails, CandleInterval, ChartDataPoint, OrderBook, LastTrade,
    TradeDirection, Account, MarginAttributes, ApiGetAccountsResponse,
    ApiFindInstrumentResponse, ApiGetCandlesResponse, ApiOrderBookResponse,
    ApiGetLastTradesResponse, ApiGetPortfolioResponse, Position, PositionStatus,
    ApiPostOrderResponse, ApiGetOrdersResponse, ApiCancelOrderResponse,
    ApiGetMarginAttributesResponse, ApiGetDividendsResponse, ApiDividend,
    ApiPostStopOrderResponse, ApiGetStopOrdersResponse, ApiStopOrder,
    ApiCancelStopOrderResponse, StopOrderDirection, StopOrderType,
    ApiGetLastPricesResponse, TradeHistoryEntry, ApiGetOperationsResponse,
    ApiMoneyValue, TradeOpType, GridOrder
} from '../types';
import { makeApiRequest, getAccountId as getApiAccountId, setAuthToken as setApiAuthToken, getServerTime as getApiServerTime, getAuthToken as getApiAuthToken } from './tInvestApi';
import { FIXED_RISK_RATE, TARGET_INSTRUMENT } from '../constants';
import { roundPriceToTick } from '../utils/math'; // IMPORT ROUNDING
import { LogType } from '../types';
import * as debugService from './debugService'; 

// --- HELPERS ---

let accountId: string | null = null;

export const mapToNumber = (value: ApiMoneyValue | undefined): number => {
    if (!value) return 0;
    const units = value.units !== undefined 
        ? (typeof value.units === 'string' ? parseInt(value.units, 10) : value.units) 
        : 0;
    const nano = value.nano !== undefined ? value.nano : 0;
    
    // NAN GUARD
    if (isNaN(units)) return 0;
    const result = units + nano / 1000000000;
    return isNaN(result) ? 0 : result;
};

// --- AUTH & ACCOUNT ---

export const getAuthToken = () => getApiAuthToken();
export const setAuthToken = (token: string) => setApiAuthToken(token);

export const getAccountId = async (force: boolean = false): Promise<string> => {
    return await getApiAccountId(force);
};

export const getServerTime = async () => getApiServerTime();

export const getAccount = async (): Promise<Account> => {
    const accountId = await getApiAccountId();
    const portfolio = await makeApiRequest<ApiGetPortfolioResponse & { totalAmountPortfolio?: ApiMoneyValue }>('tinkoff.public.invest.api.contract.v1.OperationsService/GetPortfolio', 'POST', { accountId });
    
    let totalAmount = portfolio.totalAmountCurrencies;
    let balance = totalAmount ? mapToNumber(totalAmount) : 0;
    
    // ПРЯМОЙ ПОИСК РУБЛЕЙ В ПОЗИЦИЯХ
    // Иногда API Т-Банка отдает 0 в totalAmountCurrencies, но деньги лежат как позиция 'rub'
    if (balance <= 0 && portfolio.positions && portfolio.positions.length > 0) {
        let manualRubles = 0;
        for (const pos of portfolio.positions) {
            if (pos.instrumentType === 'currency') {
                const qty = mapToNumber(pos.quantity) || 0;
                const price = mapToNumber(pos.currentPrice) || 1; 
                manualRubles += (qty * price);
            }
        }
        if (manualRubles > 0) {
            balance = manualRubles;
        }
    }

    // РЕЗЕРВНЫЙ ПОИСК ПО ОБЩЕМУ ПОРТФЕЛЮ
    if (balance <= 0 && portfolio.totalAmountPortfolio) {
        const totalPortfolioValue = mapToNumber(portfolio.totalAmountPortfolio);
        if (totalPortfolioValue > 0) {
             balance = totalPortfolioValue;
        }
    }

    // АБСОЛЮТНЫЙ ФОЛЛБЕК: ЗАПРОС ЛИМИТОВ НА ВЫВОД (WithdrawLimits)
    // Эта конечная точка всегда показывает реальный кэш без учета T+ клирингов портфеля
    if (balance <= 0) {
        try {
            const limits = await makeApiRequest<any>('tinkoff.public.invest.api.contract.v1.OperationsService/GetWithdrawLimits', 'POST', { accountId });
            if (limits && limits.money && limits.money.length > 0) {
                // Ищем рубли
                const rubLimit = limits.money.find((m: any) => m.currency === 'rub' || m.currency === 'RUB');
                if (rubLimit) {
                    balance = mapToNumber(rubLimit);
                } else {
                    balance = mapToNumber(limits.money[0]); // Если валюта одна, берем ее
                }
            }
        } catch (e) {
            // Игнорируем ошибку, фоллбек опциональный
        }
    }
    
    return {
        balance: balance,
        currency: totalAmount?.units === 'rub' ? 'RUB' : 'RUB' 
    };
};

export const getMarginAttributes = async (fallbackAccount?: Account): Promise<MarginAttributes> => {
    try {
        const accountId = await getApiAccountId();
        const res = await makeApiRequest<ApiGetMarginAttributesResponse>('tinkoff.public.invest.api.contract.v1.UsersService/GetMarginAttributes', 'POST', { accountId });
        return {
            liquidPortfolio: mapToNumber(res.liquidPortfolio),
            startingMargin: mapToNumber(res.startingMargin),
            fundsForBuy: mapToNumber(res.fundsForBuy)
        };
    } catch (e: any) {
        try {
            const acc = fallbackAccount || await getAccount();
            return {
                liquidPortfolio: acc.balance,
                startingMargin: 0,
                fundsForBuy: acc.balance
            };
        } catch (innerError) {
            throw e; 
        }
    }
};

// --- MARKET DATA ---

export const searchInstruments = async (query: string): Promise<InstrumentDetails[]> => {
    if (!query || query.length < 2) return [];
    try {
        const res = await makeApiRequest<ApiFindInstrumentResponse>(
            'tinkoff.public.invest.api.contract.v1.InstrumentsService/FindInstrument', 
            'POST', 
            { query: query, instrumentStatus: 'INSTRUMENT_STATUS_BASE' },
            true 
        );
        if (!res.instruments) return [];
        return res.instruments
            .filter(i => i.apiTradeAvailableFlag) 
            .slice(0, 5) 
            .map(i => ({
                figi: i.figi,
                name: i.name,
                lot: i.lot,
                minPriceIncrement: mapToNumber(i.minPriceIncrement),
                brokerRiskDLong: FIXED_RISK_RATE,
                brokerRiskDShort: FIXED_RISK_RATE,
                shortEnabledFlag: i.shortEnabledFlag,
                classCode: i.classCode,
                uid: i.uid,
                ticker: i.ticker
            }));
    } catch (e) {
        return [];
    }
};

export const resolveFigi = async (ticker: string, silent: boolean = false): Promise<InstrumentDetails> => {
    const isDogRequest = ticker.includes('@');
    const searchTicker = ticker.replace('@', '').trim().toUpperCase();
    
    let candidates: any[] = [];
    try {
        const res = await makeApiRequest<ApiFindInstrumentResponse>(
            'tinkoff.public.invest.api.contract.v1.InstrumentsService/FindInstrument', 
            'POST', 
            { query: searchTicker }, 
            silent
        );
        if (res.instruments) candidates = res.instruments;
    } catch (e: any) {
        console.error(`[Identity] API Error: ${e.message}`);
        throw e;
    }

    if (candidates.length === 0) {
        throw new Error(`INSTRUMENT_NOT_FOUND: API returned 0 results for '${searchTicker}'`);
    }

    const scoreCandidate = (c: any) => {
        let score = 0;
        if (c.apiTradeAvailableFlag === true) score += 10000;
        if (c.ticker === searchTicker) score += 1000;
        else if (c.ticker.includes(searchTicker)) score += 100;

        if (isDogRequest) {
            if (c.classCode === 'TQTF') score += 500; 
            if (['SPB', 'SPB_RU', 'SPBXML'].includes(c.classCode)) score += 400; 
        } else {
            if (c.classCode === 'TQBR') score += 500;
        }
        if (['OTC', 'SMAL', 'SEQ'].includes(c.classCode)) score -= 100;
        return score;
    };

    candidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
    const bestMatch = candidates[0];

    if (!bestMatch.apiTradeAvailableFlag) {
        console.warn(`[Identity] ⚠️ WARNING: ${bestMatch.ticker} is marked as NOT tradeable via API. Trading actions will fail.`);
    }

    // NEW: FETCH DEEP INSTRUMENT METADATA
    // FindInstrument usually returns an InstrumentShort object which LACKS `minPriceIncrement` (or it's null).
    // Failing to fetch the deep object causes the system to fallback to 0.01, which destroys orders for stocks with 0.02, 0.5, etc.
    let realMinPriceIncrement = mapToNumber(bestMatch.minPriceIncrement);
    let realLot = bestMatch.lot;
    
    try {
        const detailRes = await makeApiRequest<any>(
            'tinkoff.public.invest.api.contract.v1.InstrumentsService/GetInstrumentBy',
            'POST',
            { 
                idType: 'INSTRUMENT_ID_TYPE_FIGI',
                id: bestMatch.figi,
                classCode: bestMatch.classCode 
            },
            true
        );
        if (detailRes && detailRes.instrument) {
            if (detailRes.instrument.minPriceIncrement) {
                realMinPriceIncrement = mapToNumber(detailRes.instrument.minPriceIncrement);
            }
            if (detailRes.instrument.lot !== undefined) {
                realLot = detailRes.instrument.lot;
            }
        }
    } catch (e: any) {
        console.warn(`[Identity] Handled exception checking deep info for ${bestMatch.figi}:`, e.message);
    }

    // Prevent unsafe zeroes
    if (!realMinPriceIncrement || realMinPriceIncrement <= 0) {
        realMinPriceIncrement = 0.01;
    }

    return {
        figi: bestMatch.figi,
        name: bestMatch.name,
        lot: realLot,
        minPriceIncrement: realMinPriceIncrement,
        brokerRiskDLong: FIXED_RISK_RATE,  
        brokerRiskDShort: FIXED_RISK_RATE, 
        shortEnabledFlag: bestMatch.shortEnabledFlag, 
        classCode: bestMatch.classCode,
        uid: bestMatch.uid,
        ticker: bestMatch.ticker
    };
};

export const fetchCandles = async (details: InstrumentDetails, interval: CandleInterval, from: Date, to: Date): Promise<ChartDataPoint[]> => {
    const intervalMap: Record<string, string> = {
        '1m': 'CANDLE_INTERVAL_1_MIN',
        '5m': 'CANDLE_INTERVAL_5_MIN',
        '15m': 'CANDLE_INTERVAL_15_MIN',
        '30m': 'CANDLE_INTERVAL_30_MIN',
        '1h': 'CANDLE_INTERVAL_HOUR',
        '4h': 'CANDLE_INTERVAL_4_HOUR',
        '1d': 'CANDLE_INTERVAL_DAY'
    };
    
    const res = await makeApiRequest<ApiGetCandlesResponse>('tinkoff.public.invest.api.contract.v1.MarketDataService/GetCandles', 'POST', {
        figi: details.figi,
        from: from.toISOString(),
        to: to.toISOString(),
        interval: intervalMap[interval] || 'CANDLE_INTERVAL_1_MIN'
    });
    
    if (!res.candles) return [];
    
    return res.candles.map(c => ({
        time: new Date(c.time).getTime(),
        open: mapToNumber(c.open),
        high: mapToNumber(c.high),
        low: mapToNumber(c.low),
        price: mapToNumber(c.close),
        volume: parseInt(c.volume, 10)
    }));
};

export const getOrderBook = async (figi: string, depth: number = 20): Promise<OrderBook | null> => {
    const res = await makeApiRequest<ApiOrderBookResponse>('tinkoff.public.invest.api.contract.v1.MarketDataService/GetOrderBook', 'POST', { figi, depth });
    if (!res) return null;
    
    const bids = res.bids.map(b => ({ price: mapToNumber(b.price), quantity: parseInt(b.quantity, 10) }));
    const asks = res.asks.map(a => ({ price: mapToNumber(a.price), quantity: parseInt(a.quantity, 10) }));
    const lastPrice = mapToNumber(res.lastPrice);
    
    let spreadPercent = 0;
    if (bids.length > 0 && asks.length > 0) {
        const bestBid = bids[0].price;
        const bestAsk = asks[0].price;
        spreadPercent = (bestAsk - bestBid) / bestBid;
    }

    return { bids, asks, lastPrice, spreadPercent };
};

export const getLastTrades = async (figi: string, from: Date, to: Date): Promise<LastTrade[]> => {
    const res = await makeApiRequest<ApiGetLastTradesResponse>('tinkoff.public.invest.api.contract.v1.MarketDataService/GetLastTrades', 'POST', {
        figi, from: from.toISOString(), to: to.toISOString()
    });
    
    if (!res.trades) return [];
    return res.trades.map(t => ({
        price: mapToNumber(t.price),
        quantity: parseInt(t.quantity, 10),
        time: new Date(t.time).getTime(),
        direction: t.direction === 'TRADE_DIRECTION_BUY' ? TradeDirection.BUY : TradeDirection.SELL
    }));
};

export const getLastPrices = async (figis: string[]): Promise<Record<string, number>> => {
    if (!figis || figis.length === 0) return {};
    const res = await makeApiRequest<ApiGetLastPricesResponse>('tinkoff.public.invest.api.contract.v1.MarketDataService/GetLastPrices', 'POST', { figis });
    const map: Record<string, number> = {};
    if (res.lastPrices) {
        res.lastPrices.forEach((p: any) => {
            map[p.figi] = mapToNumber(p.price);
        });
    }
    return map;
};

export const getTechAnalysis = async (
    uid: string,
    indicatorType: 'INDICATOR_TYPE_BB' | 'INDICATOR_TYPE_SMA' | 'INDICATOR_TYPE_EMA' | 'INDICATOR_TYPE_RSI' | 'INDICATOR_TYPE_MACD',
    interval: 'INDICATOR_INTERVAL_1_MIN' | 'INDICATOR_INTERVAL_5_MIN' | 'INDICATOR_INTERVAL_15_MIN' | 'INDICATOR_INTERVAL_1_HOUR' | 'INDICATOR_INTERVAL_1_DAY',
    from: Date,
    to: Date,
    length: number = 20,
    deviationUnits: number = 2
): Promise<any> => {
    const res = await makeApiRequest<any>('tinkoff.public.invest.api.contract.v1.MarketDataService/GetTechAnalysis', 'POST', {
        indicatorType,
        instrumentUid: uid,
        from: from.toISOString(),
        to: to.toISOString(),
        interval,
        typeOfPrice: 'TYPE_OF_PRICE_CLOSE',
        length,
        deviation: { units: deviationUnits, nano: 0 },
        smoothing: 'SMOOTHING_SMA'
    });
    return res;
};

export const getDividends = async (figi: string, from: Date, to: Date): Promise<ApiDividend[]> => {
    const res = await makeApiRequest<ApiGetDividendsResponse>('tinkoff.public.invest.api.contract.v1.InstrumentsService/GetDividends', 'POST', {
        figi, from: from.toISOString(), to: to.toISOString()
    });
    return res.dividends || [];
};

// --- TRADING & PORTFOLIO ---

export const getPortfolio = async (): Promise<ApiGetPortfolioResponse> => {
    const accountId = await getApiAccountId();
    return await makeApiRequest<ApiGetPortfolioResponse>('tinkoff.public.invest.api.contract.v1.OperationsService/GetPortfolio', 'POST', { accountId });
};

export const getPosition = async (figi: string): Promise<Position | null> => {
    const portfolio = await getPortfolio();
    if (!portfolio.positions) return null;
    
    const pos = portfolio.positions.find((p: any) => p.figi === figi);
    if (!pos) return null;
    
    const qty = mapToNumber(pos.quantity);
    if (Math.abs(qty) < 0.000001) return null;
    
    const direction = qty > 0 ? TradeDirection.BUY : TradeDirection.SELL;
    const entryPrice = mapToNumber(pos.averagePositionPrice);
    const expectedYield = mapToNumber(pos.expectedYield);
    
    return {
        figi,
        quantity: qty,
        initialQuantity: Math.abs(qty),
        currentQuantity: qty,
        entryPrice,
        direction,
        status: PositionStatus.FULL,
        pnl: expectedYield
    };
};

export const getActiveOrders = async (figi: string): Promise<GridOrder[]> => {
    const accountId = await getApiAccountId();
    const res = await makeApiRequest<ApiGetOrdersResponse>('tinkoff.public.invest.api.contract.v1.OrdersService/GetOrders', 'POST', { accountId });
    
    if (!res.orders) return [];
    
    return res.orders
        .filter(o => {
            const status = o.executionReportStatus || o.execution_report_status;
            const itemFigi = o.figi || o.instrumentUid;
            return (itemFigi === figi) && (status === 'EXECUTION_REPORT_STATUS_NEW' || status === 'EXECUTION_REPORT_STATUS_PARTIALLYFILL');
        })
        .map(o => {
            const orderId = o.orderId || o.order_id;
            const lotsRequested = o.lotsRequested || o.lots_requested || '0';
            const lotsExecuted = o.lotsExecuted || o.lots_executed || '0';
            const orderDate = o.orderDate || o.order_date;
            const direction = o.direction;

            const unitPrice = o.initialSecurityPrice || o.initial_security_price || o.initialOrderPrice || o.initial_order_price;

            return {
                orderId: orderId,
                status: 'PENDING',
                qty: parseInt(lotsRequested, 10) - parseInt(lotsExecuted, 10),
                price: mapToNumber(unitPrice),
                direction: direction === 'ORDER_DIRECTION_BUY' ? TradeDirection.BUY : TradeDirection.SELL,
                createdAt: new Date(orderDate).getTime()
            };
        });
};

export const getOrderState = async (orderId: string): Promise<any> => {
    const accountId = await getApiAccountId();
    return await makeApiRequest<any>('tinkoff.public.invest.api.contract.v1.OrdersService/GetOrderState', 'POST', { accountId, orderId });
};

/**
 * UPDATED v14.40.0: Added explicit tickSize for precision rounding.
 */
export const placeOrder = async (
    figi: string, 
    quantity: number, 
    direction: TradeDirection, 
    type: 'MARKET' | 'LIMIT', 
    price?: number, 
    orderId?: string,
    tickSize: number = 0.01 // NEW ARGUMENT
): Promise<string> => {
    const accountId = await getApiAccountId();
    const dirStr = direction === TradeDirection.BUY ? 'ORDER_DIRECTION_BUY' : 'ORDER_DIRECTION_SELL';
    const typeStr = type === 'MARKET' ? 'ORDER_TYPE_MARKET' : 'ORDER_TYPE_LIMIT';
    
    let priceObj = undefined;
    if (type === 'LIMIT') {
        if (!price || price <= 0) {
            throw new Error(`INVALID_PRICE_FOR_LIMIT_ORDER: ${price}`);
        }
        
        // SAFETY GUARD: Use provided tick size for rounding.
        const cleanPrice = roundPriceToTick(price, tickSize);

        const units = Math.floor(cleanPrice);
        const nano = Math.round((cleanPrice - units) * 1000000000);
        priceObj = { units: String(units), nano };
        
        debugService.logTrace('TInvest', 'PLACE_ORDER_REQ', { 
            figi, quantity, dirStr, typeStr, rawPrice: price, cleanPrice, units, nano, tickSize 
        });
    }

    try {
        const res = await makeApiRequest<ApiPostOrderResponse>('tinkoff.public.invest.api.contract.v1.OrdersService/PostOrder', 'POST', {
            figi,
            quantity,
            price: priceObj,
            direction: dirStr,
            accountId,
            orderType: typeStr,
            orderId: orderId || undefined
        }, false, false, 15000); // 15s Timeout for orders
        debugService.logTrace('TInvest', 'PLACE_ORDER_SUCCESS', { figi, orderId: res.orderId });
        return res.orderId;
    } catch (e: any) {
        debugService.logTrace('TInvest', 'PLACE_ORDER_ERR', { error: e.message, figi, quantity, dirStr, typeStr });
        throw e;
    }
};

export const cancelOrder = async (orderId: string): Promise<void> => {
    const accountId = await getApiAccountId();
    await makeApiRequest<ApiCancelOrderResponse>('tinkoff.public.invest.api.contract.v1.OrdersService/CancelOrder', 'POST', { accountId, orderId }, false, false, 10000); // 10s Timeout for cancel
};

export const cancelAllOrders = async (figi: string): Promise<number> => {
    const accountId = await getApiAccountId();
    const res = await makeApiRequest<ApiGetOrdersResponse>('tinkoff.public.invest.api.contract.v1.OrdersService/GetOrders', 'POST', { accountId });
    
    if (!res.orders) return 0;
    
    const toCancel = res.orders.filter(o => o.figi === figi);
    let cancelled = 0;
    for (const o of toCancel) {
        try {
            await cancelOrder(o.orderId);
            cancelled++;
        } catch(e) {}
    }
    return cancelled;
};

/**
 * UPDATED v14.40.0: Added explicit tickSize for precision rounding.
 */
export const placeStopOrder = async (
    figi: string, 
    quantity: number, 
    price: number, 
    direction: TradeDirection, 
    type: 'STOP_LOSS' | 'TAKE_PROFIT',
    tickSize: number = 0.01 // NEW ARGUMENT
): Promise<string> => {
    const accountId = await getApiAccountId();
    
    // SAFETY GUARD for Stops too using correct tick
    const cleanPrice = roundPriceToTick(price, tickSize);
    
    const units = Math.floor(cleanPrice);
    const nano = Math.round((cleanPrice - units) * 1000000000);

    const stopPriceObj = { units: String(units), nano: nano };
    const stopOrderType = type === 'STOP_LOSS' ? StopOrderType.STOP_LOSS : StopOrderType.TAKE_PROFIT;
    const dir = direction === TradeDirection.BUY ? StopOrderDirection.BUY : StopOrderDirection.SELL;

    const res = await makeApiRequest<ApiPostStopOrderResponse>('tinkoff.public.invest.api.contract.v1.StopOrdersService/PostStopOrder', 'POST', {
        figi,
        quantity,
        stopPrice: stopPriceObj,
        direction: dir,
        accountId,
        expirationType: 'STOP_ORDER_EXPIRATION_TYPE_GOOD_TILL_CANCEL',
        stopOrderType
    }, false, false, 15000); // 15s Timeout for stops
    return res.stop_order_id;
};

export const cancelStopOrder = async (stopOrderId: string): Promise<void> => {
    const accountId = await getApiAccountId();
    await makeApiRequest<ApiCancelStopOrderResponse>('tinkoff.public.invest.api.contract.v1.StopOrdersService/CancelStopOrder', 'POST', { accountId, stopOrderId });
};

export const getStopOrders = async (figi: string): Promise<ApiStopOrder[]> => {
    const accountId = await getApiAccountId();
    const res = await makeApiRequest<ApiGetStopOrdersResponse>('tinkoff.public.invest.api.contract.v1.StopOrdersService/GetStopOrders', 'POST', { accountId });
    if (!res.stop_orders) return [];
    return res.stop_orders.filter(so => so.figi === figi);
};

export const closePosition = async (figi: string, quantity: number, limitPrice?: number): Promise<void> => {
    const pos = await getPosition(figi);
    if (!pos || Math.abs(pos.currentQuantity) < 0.000001) {
        throw new Error("POSITION_NOT_FOUND");
    }
    
    const closeDir = pos.direction === TradeDirection.BUY ? TradeDirection.SELL : TradeDirection.BUY;
    const qtyToClose = Math.min(Math.abs(quantity), Math.abs(pos.currentQuantity));
    
    if (qtyToClose < 1 && qtyToClose <= 0.000001) {
         console.warn("[TInvest] Attempted to close zero/dust quantity. Skipping.");
         return;
    }
    
    if (limitPrice && limitPrice > 0) {
        await placeOrder(figi, qtyToClose, closeDir, 'LIMIT', limitPrice);
    } else {
        await placeOrder(figi, qtyToClose, closeDir, 'MARKET');
    }
};

export const fetchOperationalHistory = async (): Promise<TradeHistoryEntry[]> => {
    const accountId = await getApiAccountId();
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = new Date();

    try {
        const response = await makeApiRequest<ApiGetOperationsResponse>('tinkoff.public.invest.api.contract.v1.OperationsService/GetOperations', 'POST', {
            accountId,
            from: from.toISOString(),
            to: to.toISOString(),
            state: 'OPERATION_STATE_EXECUTED' 
        });

        const history: TradeHistoryEntry[] = [];
        
        if (response.operations) {
            response.operations.forEach((op: any) => {
                const unitPrice = mapToNumber(op.price);
                const totalPayment = mapToNumber(op.payment); 
                const commission = mapToNumber(op.commission);
                const yieldVal = mapToNumber(op.yield);
                const qty = parseInt(op.quantityExecuted || op.quantity || '0', 10);
                
                let readableReason = op.type;
                let outcome: 'Success' | 'Failure' | 'Neutral' = 'Neutral';
                let opType: TradeOpType = 'OTHER';
                let effectivePnl = 0;
                let displayEntryPrice = unitPrice; 
                let effectiveVolume = Math.abs(totalPayment);

                switch (op.type) {
                    case 'OPERATION_TYPE_BUY':
                    case 'OPERATION_TYPE_BUY_CARD':
                        readableReason = 'Покупка';
                        opType = 'TRADE';
                        effectivePnl = 0; 
                        break;
                    case 'OPERATION_TYPE_SELL':
                    case 'OPERATION_TYPE_SELL_CARD':
                        readableReason = 'Продажа';
                        opType = 'TRADE';
                        effectivePnl = yieldVal; 
                        outcome = yieldVal >= 0 ? 'Success' : 'Failure';
                        break;
                    case 'OPERATION_TYPE_INPUT':
                    case 'OPERATION_TYPE_INPUT_CARD':
                        readableReason = '💵 Пополнение';
                        opType = 'TRANSFER';
                        displayEntryPrice = Math.abs(totalPayment);
                        break;
                    case 'OPERATION_TYPE_OUTPUT':
                        readableReason = '💸 Вывод';
                        opType = 'TRANSFER';
                        displayEntryPrice = Math.abs(totalPayment);
                        break;
                    case 'OPERATION_TYPE_DIVIDEND':
                    case 'OPERATION_TYPE_TAX':
                        readableReason = op.type.includes('DIVIDEND') ? '💰 Дивиденды' : 'Налог';
                        opType = op.type.includes('DIVIDEND') ? 'DIVIDEND' : 'TAX';
                        effectivePnl = totalPayment; 
                        break;
                    case 'OPERATION_TYPE_BROKER_FEE':
                        readableReason = 'Комиссия';
                        opType = 'FEE';
                        effectivePnl = totalPayment; 
                        break;
                    default:
                        readableReason = op.type.replace('OPERATION_TYPE_', '');
                }

                history.push({
                    type: opType,
                    pnl: effectivePnl,
                    outcome: outcome,
                    decisionReason: readableReason,
                    exitTime: new Date(op.date).getTime(),
                    entryPrice: displayEntryPrice, 
                    exitPrice: displayEntryPrice,
                    quantity: qty,
                    volume: effectiveVolume, 
                    commission: Math.abs(commission)
                });
            });
        }
        return history;
    } catch (e: any) {
        throw e;
    }
};
