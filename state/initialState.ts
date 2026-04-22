
import { 
    BotState, BotStatus, ConnectionStatus, KernelStatus, 
    MarketPhase, TaskStatus 
} from '../types';
import { 
    PROJECT_VERSION, TARGET_INSTRUMENT,
    DAILY_DRAWDOWN_LIMIT_PERCENT, MAX_LEVERAGE,
    SESSION_WARMUP_HOUR, SUNSET_HARD_CLOSE_HOUR, SUNSET_HARD_CLOSE_MINUTE
} from '../constants';

export const initialState: BotState = {
    status: BotStatus.STOPPED,
    isBotActive: false,
    connectionStatus: ConnectionStatus.DISCONNECTED,
    kernelStatus: KernelStatus.IDLE,
    account: null,
    position: null,
    marginAttributes: null,
    instrumentDetails: null,
    instrumentTicker: TARGET_INSTRUMENT, 
    chartData: { '1m': [], '5m': [], '15m': [], '30m': [], '1h': [], '4h': [], '1d': [] },
    orderBook: null,
    lastTrades: [],
    currentAnalysis: null,
    manualLotSize: 1,
    riskPerTrade: 1,
    leverageMultiplier: 1,
    effectiveBuyingPower: 0,
    activeGridOrders: [],
    tradeHistory: [],
    logs: [],
    health: { status: 'OK', lastCycleDurationMs: 0, consecutiveErrors: 0, lastCheck: Date.now() },
    workerStatus: 'INITIATING',
    workerError: null,
    telemetry: { rsi: null, phase: MarketPhase.NEUTRAL, driver: 'NONE', trendStrength: 0 },
    protocolStatus: 'SYNCED',
    systemVersion: PROJECT_VERSION,
    systemTasks: [
        { id: 'strategist', name: '🛡️ TITAN-70-30 Engine', status: TaskStatus.IDLE, lastRun: null, nextRun: null },
    ],
    serverStopLossLevel: null,
    systemConfig: {
        risk: {
            maxDailyLossPercent: DAILY_DRAWDOWN_LIMIT_PERCENT,
            maxLeverage: MAX_LEVERAGE,
            maxDrawdownAction: 'STOP'
        },
        time: {
            sessionStartHour: SESSION_WARMUP_HOUR,
            sessionEndHour: SUNSET_HARD_CLOSE_HOUR,
            forceCloseHour: SUNSET_HARD_CLOSE_HOUR,
            forceCloseMinute: SUNSET_HARD_CLOSE_MINUTE
        }
    }
};
