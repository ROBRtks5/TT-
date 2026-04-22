
import { BotState, KernelStatus, LogType, BotStatus } from '../types';
import { WorkerMessage, WorkerCommand } from './worker-types';
import { initialState } from '../state/initialState';
import { streamManager } from '../services/streamManager';
import * as tInvestService from '../services/tInvestService';
import { DataController } from './controllers/DataController';
import { OrderController } from './controllers/OrderController';
import { StrategyController } from './controllers/StrategyController';
import { isMarketOpenNow, isWeekend } from '../utils/marketTime';
import { UI_UPDATE_THROTTLE_MS } from '../constants';
import * as debugService from '../services/debugService'; // IMPORT DEBUG
import { tradeStreamService } from '../services/tradeStreamService';

// Helper for soft start
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class BotKernel {
    private state: BotState = { ...initialState };
    private postMessage: (msg: WorkerMessage) => void;
    public disposed = false;
    private lastWakeUpTime = 0;
    private staleStatusStartTime = 0; // TITAN-IRONCLAD-3.2: Phoenix Proto Tracker
    private heartbeatTimer: any;
    private diagnosticTimer: any; // NEW: Timer for periodic extensive logging
    private healingTimer: any; // FIX: Timer for self-healing loop
    
    // UI Throttling State
    private pendingStateUpdate: Partial<BotState> | null = null;
    private uiUpdateTimer: any = null;

    // Controllers
    public dataController: DataController;
    public orderController: OrderController;
    public strategyController: StrategyController;

    private strategyTimer: any = null;
    private isStrategyLoopRunning = false;
    private isSystemStarting = false;

    constructor(postMessage: (msg: WorkerMessage) => void) {
        this.postMessage = postMessage;
        this.dataController = new DataController(this);
        this.orderController = new OrderController(this);
        this.strategyController = new StrategyController(this);

        // Connect Trade Stream to Order Controller
        tradeStreamService.setOnFillCallback((event) => {
            this.orderController.handleOrderFill(event);
        });

        this.heartbeatTimer = setInterval(() => {
            if (!this.disposed) {
                const now = Date.now();

                // TITAN-IRONCLAD-3.2: Phoenix Protocol Watchdog
                const status = this.state.status;
                if (this.state.isBotActive && status === 'STALE_DATA') {
                    if (this.staleStatusStartTime > 0 && (now - this.staleStatusStartTime) > 45000) {
                        this.log(LogType.WARNING, "🔥 PHOENIX: Данные отсутствуют слишком долго (45с+). Принудительная инициация восстановления...");
                        this.staleStatusStartTime = now; // Prevent spamming
                        streamManager.reconnect();
                    }
                }

                if (this.lastWakeUpTime > 0 && (now - this.lastWakeUpTime) > 15000) {
                     streamManager.forceRefresh();
                }
                this.lastWakeUpTime = now;
                this.postMessage({ type: 'HEARTBEAT' });
            }
        }, 10000);

        this._startUiLoop(); // Start throttling loop
    }

    private _startUiLoop() {
        this.uiUpdateTimer = setInterval(() => {
            if (this.pendingStateUpdate && !this.disposed) {
                this.postMessage({ type: 'PARTIAL_STATE_UPDATE', payload: this.pendingStateUpdate });
                this.pendingStateUpdate = null;
            }
        }, UI_UPDATE_THROTTLE_MS);
    }

    public async handleCommand(command: WorkerCommand) {
        if (this.disposed) return;

        try {
            switch (command.type) {
                case 'START_BOT':
                    await this.start();
                    break;
                case 'STOP_BOT':
                    await this.stop();
                    break;
                case 'SAVE_API_KEY':
                    const { apiKey, newsApiKey } = command.payload;
                    tInvestService.setAuthToken(apiKey);
                    this.log(LogType.INFO, "API ключи обновлены в ядре.");
                    break;
                case 'SET_MANUAL_LOT_SIZE':
                    this.updateState({ manualLotSize: command.payload });
                    break;
                case 'SET_LEVERAGE_MULTIPLIER':
                    this.updateState({ leverageMultiplier: command.payload });
                    break;
                case 'UPDATE_BIOS_SETTINGS':
                    this.updateState({ systemConfig: { ...this.state.systemConfig, ...command.payload } });
                    this.log(LogType.SYSTEM, "BIOS настройки обновлены.");
                    break;
                case 'SET_INSTRUMENT_TICKER':
                    // PROTOCOL TABULA RASA: Wipe state for new ticker immediately
                    this.updateState({ 
                        instrumentTicker: command.payload,
                        chartData: { '1m': [], '5m': [], '15m': [], '30m': [], '1h': [], '4h': [], '1d': [] },
                        orderBook: null,
                        lastTrades: [],
                        position: null,
                        instrumentDetails: null,
                        currentAnalysis: null
                    }, true); // FORCE UPDATE
                    
                    this.log(LogType.SYSTEM, `Целевой инструмент изменен на: ${command.payload}`);
                    // HOT RELOAD LOGIC
                    if (this.state.isBotActive) {
                        this.log(LogType.INFO, "🔄 Перезагрузка данных для нового инструмента...");
                        this.dataController.initialize().then(() => {
                             streamManager.forceRefresh(); // Ensure subscriptions activate
                        }).catch(err => {
                             this.log(LogType.ERROR, "Ошибка смены инструмента: " + err.message);
                             this.updateState({ isBotActive: false, status: BotStatus.ERROR });
                        });
                    }
                    break;
                case 'IMPORT_VAULT':
                    this.importVault(command.payload);
                    break;
                case 'RESET_MEMORY':
                    this.resetMemory();
                    break;
                case 'EMERGENCY_API_RESET':
                    await this.emergencyReset();
                    break;
                case 'FORCE_CLOSE_POSITION':
                    await this.forceClose();
                    break;
                case 'WAKE_UP':
                    this.lastWakeUpTime = Date.now();
                    break;
                case 'RUN_OFFLINE_SIMULATION':
                    await this.runSimulation();
                    break;
                case 'IMMEDIATE_STATE_SAVE':
                    this.state = command.payload;
                    this.forceSave();
                    break;
            }
        } catch (e: any) {
            console.error("Command Error:", e);
            this.log(LogType.ERROR, `Ошибка команды ${command.type}: ${e.message}`);
        }
    }

    private async runSimulation() {
        this.log(LogType.INFO, "🧪 SIMULATION: Модуль симуляции отключен в текущей версии.");
    }

    public async syncStateWithExchange() {
        const figi = this.state.instrumentDetails?.figi;
        if (!figi) return;

        this.log(LogType.SYSTEM, "🔄 СИНХРОНИЗАЦИЯ: Сверка реальности с биржей...");

        try {
            const activeOrders = await tInvestService.getActiveOrders(figi);
            if (activeOrders.length > 0) {
                this.log(LogType.WARNING, `🧹 Сброс ${activeOrders.length} старых ордеров (Clean Slate Protocol)...`);
                await tInvestService.cancelAllOrders(figi);
                this.updateState({ activeGridOrders: [] }); 
                
                // CRITICAL FIX: Delay to allow Tinkoff risk backend to release asset locks
                this.log(LogType.INFO, `⏳ Ожидание разблокировки активов брокером (2 сек)...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            const realPosition = await tInvestService.getPosition(figi);

            if (realPosition && Math.abs(realPosition.currentQuantity) > 0) {
                this.log(LogType.INFO, `📊 Обнаружена позиция: ${realPosition.currentQuantity} шт @ ${realPosition.entryPrice.toFixed(2)}`);
                this.updateState({ position: realPosition });
            } else {
                this.updateState({ position: null });
            }

            // --- REFRESH ACCOUNT & HISTORY ---
            await this.dataController.forceMarginRefresh().catch(e => console.error("Initial refresh failed:", e));

            this.log(LogType.SUCCESS, "✅ СИНХРОНИЗАЦИЯ ЗАВЕРШЕНА. Данные валидны.");

        } catch (e: any) {
            this.log(LogType.ERROR, `❌ ОШИБКА СИНХРОНИЗАЦИИ: ${e.message}`);
            throw e; 
        }
    }

    private async start() {
        if (this.isSystemStarting || this.state.status === BotStatus.TRADING) return;
        this.isSystemStarting = true;
        
        this.updateState({ isBotActive: true, status: BotStatus.STARTING }, true);
        this.log(LogType.SYSTEM, "🚀 ЗАПУСК: Инициализация холодного старта...");

        if (!tInvestService.getAuthToken()) {
            this.log(LogType.ERROR, "Нет API ключа. Запуск невозможен.");
            this.updateState({ isBotActive: false, status: BotStatus.STOPPED });
            this.isSystemStarting = false;
            return;
        }

        try {
            // [0] Фаза синхронизации (Очистка реальной биржи)
            await this.syncStateWithExchange();
            
            this.log(LogType.INFO, "🔍 [Фаза 1/3] Проверка подсистем...");
            await this.dataController.initialize();
            
            await sleep(500); 

            // [1] Принудительная очистка ордеров перед началом (Cold Start)
            const figi = this.state.instrumentDetails?.figi;
            if (figi) {
                this.log(LogType.INFO, "🧹 [Фаза 2/3] Очистка стакана для чистого старта...");
                await tInvestService.cancelAllOrders(figi);
                this.updateState({ activeGridOrders: [] }, true);
                await sleep(1000);
            }
            
            this.log(LogType.INFO, "📡 [Фаза 3/3] Установка связи и разогрев...");
            tradeStreamService.startWarmup();
            await streamManager.connect();
            
            if (figi) {
                streamManager.subscribeCandles(figi, '1m');
                streamManager.subscribeOrderBook(figi);
                streamManager.subscribeTrades(figi);
                streamManager.subscribePortfolio(figi);
            }

            if (isWeekend() || !isMarketOpenNow()) {
                this.updateState({ status: BotStatus.MARKET_CLOSED }, true);
                this.log(LogType.WARNING, "🌙 РЫНОК ЗАКРЫТ. Режим наблюдения.");
            } else {
                this.updateState({ status: BotStatus.TRADING }, true);
                this.log(LogType.SUCCESS, "🟢 TITAN READY. Трейдинг активен.");
            }

            this.isStrategyLoopRunning = true;
            this.runStrategyLoop();

        } catch (e: any) {
            this.updateState({ isBotActive: false, status: BotStatus.ERROR });
            this.log(LogType.ERROR, `❌ КРИТИЧЕСКИЙ СБОЙ ПРИ СТАРТЕ: ${e.message}`);
        } finally {
            this.isSystemStarting = false;
        }
    }

    private async runStrategyLoop() {
        if (!this.state.isBotActive || !this.isStrategyLoopRunning) return;

        try {
            await this.strategyController._runStrategistTask();
        } catch (e: any) {
            console.warn("Strategy Loop Error (Recovered):", e);
        }

        // DOUBLE CHECK: Если во время асинхронного цикла пришла команда Стоп — не запускаем следующий цикл
        if (this.state.isBotActive && this.isStrategyLoopRunning) {
            this.strategyTimer = setTimeout(() => this.runStrategyLoop(), 5000); 
        } else {
            this.log(LogType.INFO, "💤 Цикл стратегии остановлен.");
        }
    }

    private async stop() {
        if (!this.state.isBotActive) return;
        
        this.log(LogType.SYSTEM, "🛑 STOP: Инициализация протокола остановки...");
        this.isStrategyLoopRunning = false;
        if (this.strategyTimer) clearTimeout(this.strategyTimer);
        
        // --- SECURE HALT ---
        const figi = this.state.instrumentDetails?.figi;
        if (figi) {
            try {
                this.log(LogType.INFO, "🛑 Снятие всех заявок...");
                await tInvestService.cancelAllOrders(figi);
                this.updateState({ activeGridOrders: [] }, true);
                this.log(LogType.SUCCESS, "✅ Ликвидность выведена.");
            } catch (e: any) {
                this.log(LogType.ERROR, "Ошибка снятия заявок: " + e.message);
            }
        }
        
        this.updateState({ isBotActive: false, status: BotStatus.STOPPED }, true);
        this.log(LogType.SYSTEM, "🛑 СИСТЕМА ОСТАНОВЛЕНА.");
    }

    private importVault(json: string) {
        try {
            const data = JSON.parse(json);
            const newState = { ...this.state, ...data };
            this.state = newState;
            this.postMessage({ type: 'REPLACE_STATE', payload: newState });
            this.log(LogType.SUCCESS, "Память восстановлена из хранилища.");
        } catch (e: any) {
            this.log(LogType.ERROR, "Ошибка импорта памяти: " + e.message);
        }
    }

    private resetMemory() {
        const cleanState = { ...initialState };
        this.state = cleanState;
        this.postMessage({ type: 'REPLACE_STATE', payload: cleanState });
        this.log(LogType.WARNING, "☢️ ПАМЯТЬ ПОЛНОСТЬЮ ОЧИЩЕНА.");
    }

    private async emergencyReset() {
        this.log(LogType.WARNING, "☢️ ЭКСТРЕННЫЙ СБРОС ОРДЕРОВ...");
        const figi = this.state.instrumentDetails?.figi;
        if (figi) {
            try {
                await tInvestService.cancelAllOrders(figi);
                this.updateState({ activeGridOrders: [] });
                this.log(LogType.SUCCESS, "Все активные ордера сняты.");
            } catch (e: any) {
                this.log(LogType.ERROR, `Ошибка сброса: ${e.message}`);
            }
        }
    }

    private async forceClose() {
        this.log(LogType.WARNING, "⚡ FORCE CLOSE: Закрытие позиции по рынку...");
        const figi = this.state.instrumentDetails?.figi;
        const pos = this.state.position;
        
        if (figi && pos && pos.currentQuantity !== 0) {
            try {
                this.log(LogType.INFO, "1. Снятие лимитных заявок...");
                await tInvestService.cancelAllOrders(figi);
                
                await new Promise(r => setTimeout(r, 500));

                this.log(LogType.INFO, "2. Отправка рыночного ордера...");
                await tInvestService.closePosition(figi, pos.currentQuantity);
                
                this.log(LogType.SUCCESS, "Позиция закрыта.");
                await this.dataController.forceMarginRefresh();
                
            } catch (e: any) {
                this.log(LogType.ERROR, `Ошибка закрытия: ${e.message}`);
            }
        } else {
            this.log(LogType.INFO, "Нет открытой позиции для закрытия.");
        }
    }

    public getState(): BotState {
        return this.state;
    }

    /**
     * UPDATED: Smart State Update with Throttling
     * @param partial New state fragment
     * @param forceImmediate If true, bypasses throttle (for critical status updates)
     */
    public updateState(
        partial: Partial<BotState> | ((prev: BotState) => Partial<BotState>), 
        forceImmediate: boolean = false
    ) {
        if (typeof partial === 'function') {
            const result = partial(this.state);
            
            // TITAN-IRONCLAD-3.2: Track stale status start time
            if (result.status === 'STALE_DATA' && this.state.status !== 'STALE_DATA') {
                this.staleStatusStartTime = Date.now();
            } else if (result.status && result.status !== 'STALE_DATA') {
                this.staleStatusStartTime = 0;
            }

            this.state = { ...this.state, ...result };
            this.applyUpdate(result, forceImmediate);
        } else {
            // TITAN-IRONCLAD-3.2: Track stale status start time
            if (partial.status === 'STALE_DATA' && this.state.status !== 'STALE_DATA') {
                this.staleStatusStartTime = Date.now();
            } else if (partial.status && partial.status !== 'STALE_DATA') {
                this.staleStatusStartTime = 0;
            }

            this.state = { ...this.state, ...partial };
            this.applyUpdate(partial, forceImmediate);
        }
    }

    private applyUpdate(fragment: Partial<BotState>, forceImmediate: boolean) {
        if (forceImmediate) {
            this.postMessage({ type: 'PARTIAL_STATE_UPDATE', payload: fragment });
        } else {
            this.pendingStateUpdate = { ...this.pendingStateUpdate, ...fragment };
        }
    }
    
    public forceSave() {
        this.postMessage({ type: 'IMMEDIATE_STATE_SAVE', payload: this.state });
    }

    public log(type: LogType, message: string, component?: string, metadata?: Record<string, any>) {
        this.postMessage({ 
            type: 'LOG', 
            payload: { 
                id: Date.now(), 
                timestamp: new Date().toLocaleTimeString(), 
                type, 
                message,
                component,
                metadata
            } 
        });
    }

    public updateKernelStatus(status: KernelStatus) {
        this.updateState({ kernelStatus: status }, true);
        this.postMessage({ type: 'KERNEL_STATUS_UPDATE', payload: { status, error: null } });
    }

    public dispose() {
        this.disposed = true;
        this.isStrategyLoopRunning = false;
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (this.strategyTimer) clearTimeout(this.strategyTimer);
        if (this.uiUpdateTimer) clearInterval(this.uiUpdateTimer);
        if (this.diagnosticTimer) clearInterval(this.diagnosticTimer);
        if (this.healingTimer) clearInterval(this.healingTimer);
        streamManager.disconnect();
    }
}
