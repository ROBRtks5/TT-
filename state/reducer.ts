
/**
 * TITAN TRADING BOT - REDUCER
 * ---------------------------------------------------------
 * @module state/reducer.ts
 * @version 8.2.0 (TABULA RASA)
 * @phase Protocol Control
 * @last-updated 2025-12-30
 * @description
 * Чистая функция редьюсера для управления состоянием React.
 * UPD 8.2.0: Implemented Tabula Rasa (Complete state wipe on ticker switch).
 * ---------------------------------------------------------
 */

import { BotState, KernelStatus, CandleInterval, LogEntry, ChartDataPoint } from '../types';
import { PartialStatePayload } from '../worker/worker-types';

export type BotAction =
    | { type: 'SET_KERNEL_STATUS'; payload: { status: number; error: string | null } }
    | { type: 'REPLACE_STATE'; payload: BotState }
    | { type: 'PARTIAL_STATE_UPDATE'; payload: PartialStatePayload }
    | { type: 'SET_WATCHER_DATA'; payload: any }
    | { type: 'SET_LEVERAGE_MULTIPLIER_OPTIMISTIC'; payload: number }
    | { type: 'ADD_LOG'; payload: LogEntry }
    | { type: 'SET_INSTRUMENT_TICKER'; payload: string }; 

// HELPER: Ensure value is a valid array, else return empty array.
// This is the "Sanitary Cordon" against corrupted state.
const safeArray = <T>(val: any): T[] => Array.isArray(val) ? val : [];

export const botReducer = (state: BotState, action: BotAction): BotState => {
    switch (action.type) {
        case 'SET_KERNEL_STATUS':
            let newWorkerStatus: BotState['workerStatus'] = state.workerStatus;
            if (action.payload.status === KernelStatus.READY) {
                newWorkerStatus = 'READY';
            } else if (action.payload.status === KernelStatus.FAILED) {
                newWorkerStatus = 'FAILED';
            }
            
            return {
                ...state,
                kernelStatus: action.payload.status,
                workerError: action.payload.error,
                workerStatus: newWorkerStatus,
            };

        case 'REPLACE_STATE': {
            const newState = { ...state, ...action.payload };
            
            // DIAMOND BUNKER: Strict Array Sanitization
            newState.logs = safeArray(newState.logs);
            newState.tradeHistory = safeArray(newState.tradeHistory);
            newState.systemTasks = safeArray(newState.systemTasks);
            
            return newState;
        }
        
        case 'PARTIAL_STATE_UPDATE': {
            const { chartData: chartDataUpdate, ...rest } = action.payload;
            const newState = { ...state, ...rest };

            // DIAMOND BUNKER: Partial Update Sanitization
            if (rest.logs) newState.logs = safeArray(rest.logs);
            if (rest.tradeHistory) newState.tradeHistory = safeArray(rest.tradeHistory);

            if (chartDataUpdate) {
                const newChartData = { ...state.chartData };
                for (const key in chartDataUpdate) {
                    const interval = key as CandleInterval;
                    const newCandles = chartDataUpdate[interval];
                    if (newCandles && newCandles.length > 0) {
                        const existing = newChartData[interval] || [];
                        const candleMap = new Map(existing.map(c => [c.time, c]));
                        newCandles.forEach(c => candleMap.set(c.time, c));
                        // Fix: cast to ChartDataPoint for sorting
                        newChartData[interval] = Array.from(candleMap.values())
                            .sort((a,b) => (a as ChartDataPoint).time - (b as ChartDataPoint).time)
                            .slice(-1000);
                    }
                }
                newState.chartData = newChartData;
            }

            return newState;
        }

        case 'ADD_LOG':
            // CRITICAL FIX: Ensure state.logs is an array before spreading
            const currentLogs = safeArray<LogEntry>(state.logs);
            return {
                ...state,
                logs: [action.payload, ...currentLogs].slice(0, 500)
            };

        case 'SET_WATCHER_DATA':
             return { ...state, ...action.payload };
        case 'SET_LEVERAGE_MULTIPLIER_OPTIMISTIC':
            return { 
                ...state, 
                leverageMultiplier: action.payload 
            };
        case 'SET_INSTRUMENT_TICKER':
            return { 
                ...state, 
                instrumentTicker: action.payload,
                // PROTOCOL TABULA RASA: Clean state immediately
                chartData: { '1m': [], '5m': [], '15m': [], '30m': [], '1h': [], '4h': [], '1d': [] },
                orderBook: null,
                lastTrades: [],
                position: null,
                instrumentDetails: null, // Forces loading UI
                currentAnalysis: null
            };
        default:
            return state;
    }
};
