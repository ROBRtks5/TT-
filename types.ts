
// --- TITAN HYBRID SYSTEM TYPES ---

export type AmmCapitalState = {
    totalCapitalValue: number;
    gridCash: number;
    gridAssetQty: number;
    gridAssetValue: number;
    targetGridCash: number;
    targetGridAssetValue: number;
    liquidityFundValue?: number; // LQDT, TMON, or similar money market fund value
};

export type Position = {
    figi: string;
    quantity: number;
    initialQuantity: number;
    currentQuantity: number;
    entryPrice: number;
    direction: TradeDirection;
    status: PositionStatus;
    pnl: number;
    expectedYield?: number;
};

export type TradeHistoryEntry = {
    id?: string;
    type?: TradeOpType;
    pnl: number;
    outcome: 'Success' | 'Failure' | 'Neutral';
    decisionReason: string;
    exitTime: number;
    entryPrice: number;
    exitPrice: number;
    quantity: number;
    volume: number;
    commission?: number;
};

export type LogEntry = {
    id: number;
    timestamp: string;
    type: LogType;
    message: string;
    component?: string;
    metadata?: Record<string, any>;
    details?: any;
};

export type BotState = {
    status: BotStatus;
    machineState: MachineState;
    isBotActive: boolean;
    connectionStatus: ConnectionStatus;
    kernelStatus: KernelStatus;
    account: Account | null;
    position: Position | null;
    marginAttributes: MarginAttributes | null;
    instrumentDetails: InstrumentDetails | null;
    instrumentTicker: string;
    chartData: MultiTimeframeChartData;
    orderBook: OrderBook | null;
    lastTrades: LastTrade[];
    currentAnalysis: any; // Placeholder for future expansion
    manualLotSize: number;
    riskPerTrade: number;
    leverageMultiplier: number;
    effectiveBuyingPower: number;
    activeGridOrders: GridOrder[];
    tradeHistory: TradeHistoryEntry[];
    logs: LogEntry[];
    health: HealthState;
    workerStatus: 'INITIATING' | 'READY' | 'FAILED';
    workerError: string | null;
    telemetry: { rsi: number | null; phase: MarketPhase; driver: string; trendStrength: number };
    protocolStatus: string;
    systemVersion: string;
    systemTasks: SystemTaskState[];
    serverStopLossLevel: number | null;
    systemConfig: SystemConfig;
    ammCapitalState?: AmmCapitalState;
    liquidityFundFigi?: string;
};

export type GridOrder = {
    orderId: string;
    figi?: string;
    status: string;
    qty: number;
    price: number;
    direction: TradeDirection;
    createdAt: number;
    lastUpdateTime?: number; // TITAN-IRONCLAD: Защита от старых ордеров
    metadata?: {
        reason: string;
        expectedProfit?: number;
        targetPrice?: number;
    }
};

export type SystemTaskState = {
    id: string;
    name: string;
    status: TaskStatus;
    lastRun: number | null;
    nextRun: number | null;
};

export type SystemConfig = {
    risk: {
        maxDailyLossPercent: number;
        maxLeverage: number;
        maxDrawdownAction: 'STOP' | 'CLOSE_ALL';
    };
    time: {
        sessionStartHour: number;
        sessionEndHour: number;
        forceCloseHour: number;
        forceCloseMinute: number;
    };
};

export enum LogType { INFO = 'INFO', SUCCESS = 'SUCCESS', ERROR = 'ERROR', WARNING = 'WARNING', SYSTEM = 'SYSTEM', TRADE = 'TRADE' }
export enum KernelStatus { IDLE = 0, STARTING = 1, READY = 2, STOPPING = 3, FAILED = 4, LOADING_VAULT = 5, RESOLVING_FIGI = 6 }
export enum BotStatus { STOPPED = 'STOPPED', STARTING = 'STARTING', TRADING = 'TRADING', WAITING = 'WAITING', ANALYZING = 'ANALYZING', ERROR = 'ERROR', SCHEDULED = 'SCHEDULED', STALE_DATA = 'STALE_DATA', TRADING_BANNED = 'TRADING_BANNED', ENTERING_GRID = 'ENTERING_GRID', MARKET_CLOSED = 'MARKET_CLOSED', STOPPING = 'STOPPING' }
export enum MachineState { TRADING = 'TRADING', REBALANCING = 'REBALANCING', EOD_SWEEP = 'EOD_SWEEP', NIGHT_PARK = 'NIGHT_PARK', MORNING_WAKEUP = 'MORNING_WAKEUP', DEEP_HOLD = 'DEEP_HOLD', MORNING_SELL_ONLY = 'MORNING_SELL_ONLY' }
export enum ConnectionStatus { CONNECTED = 'CONNECTED', CONNECTING = 'CONNECTING', DISCONNECTED = 'DISCONNECTED', ERROR = 'ERROR', RECONNECTING = 'RECONNECTING' }
export type CandleInterval = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';
export type MultiTimeframeChartData = Partial<Record<CandleInterval, ChartDataPoint[]>>;
export type ChartDataPoint = { 
    time: number; open: number; high: number; low: number; price: number; volume: number; 
    sma?: number | null; bbUpper?: number | null; bbLower?: number | null; rsi?: number | null 
};
export type InstrumentDetails = { figi: string; name: string; lot: number; minPriceIncrement: number; brokerRiskDLong: number; brokerRiskDShort: number; shortEnabledFlag: boolean; classCode: string; uid: string; ticker?: string };
export type Account = { balance: number; currency: string };
export type MarginAttributes = { liquidPortfolio: number; startingMargin: number; fundsForBuy: number; isFallback?: boolean; };
export enum TradeDirection { BUY = 'BUY', SELL = 'SELL' }
export type OrderBook = { bids: { price: number; quantity: number }[]; asks: { price: number; quantity: number }[]; lastPrice: number; spreadPercent: number; limitUp?: number; limitDown?: number };
export type LastTrade = { price: number; quantity: number; time: number; direction: TradeDirection };
export enum PositionStatus { FULL = 'FULL', PARTIAL = 'PARTIAL' }
export type TradeOpType = 'TRADE' | 'TRANSFER' | 'DIVIDEND' | 'FEE' | 'TAX' | 'OTHER';
export type HealthState = { status: 'OK' | 'ERROR'; lastCycleDurationMs: number; consecutiveErrors: number; lastCheck: number };
export enum MarketPhase { NEUTRAL = 'NEUTRAL', ACCUMULATION = 'ACCUMULATION', EXPANSION = 'EXPANSION', DISTRIBUTION = 'DISTRIBUTION', DECLINE = 'DECLINE', PANIC = 'PANIC', EUPHORIA = 'EUPHORIA' }
export enum TaskStatus { IDLE = 'IDLE', RUNNING = 'RUNNING', PENDING = 'PENDING' }

// --- API TYPES ---
export type ApiMoneyValue = { units: string | number; nano: number };
export type ApiGetAccountsResponse = { accounts: any[] };
export type ApiFindInstrumentResponse = { instruments: any[] };
export type ApiGetCandlesResponse = { candles: any[] };
export type ApiOrderBookResponse = { bids: any[]; asks: any[]; lastPrice: any; limitUp?: any; limitDown?: any };
export type ApiGetLastTradesResponse = { trades: any[] };
export type ApiGetLastPricesResponse = { lastPrices: any[] };
export type ApiGetPortfolioResponse = { totalAmountCurrencies: any; positions: any[] };
export type ApiPostOrderResponse = { orderId: string };
export type ApiGetOrdersResponse = { orders: any[] };
export type ApiCancelOrderResponse = { time: string };
export type ApiGetMarginAttributesResponse = { liquidPortfolio: any; startingMargin: any; fundsForBuy: any };
export type ApiGetOperationsResponse = { operations: any[] };
export type ApiGetDividendsResponse = { dividends: any[] };
export type ApiDividend = { dividendNet: any; paymentDate: string };
export type ApiPostStopOrderResponse = { stop_order_id: string };
export type ApiGetStopOrdersResponse = { stop_orders: any[] };
export type ApiStopOrder = { stop_order_id: string; figi: string };
export type ApiCancelStopOrderResponse = { time: string };
export enum StopOrderDirection { BUY = 1, SELL = 2 }
export enum StopOrderType { STOP_LOSS = 1, TAKE_PROFIT = 2 }

export type VirtualOrder = { 
    price: number; 
    volume: number; 
    direction: TradeDirection; 
    levelIndex: number;
    metadata?: GridOrder['metadata']; // TITAN-IRONCLAD
    idempotencyKey?: string;
};
