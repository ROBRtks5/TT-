
import { BotState, LogEntry, TradeHistoryEntry, SystemTaskState, TaskStatus } from '../types';
import * as db from './databaseService';
import { PROJECT_VERSION } from '../constants';
import { initialState } from '../state/initialState';

const VAULT_KEY = 'TITAN_VAULT_V1';
export const CURRENT_DATA_VERSION = 1;

export const DEFAULT_SYSTEM_TASKS: SystemTaskState[] = [
    { id: 'oracle', name: '🔮 Оракул (Макро)', status: TaskStatus.IDLE, lastRun: null, nextRun: null },
    { id: 'strategist', name: '🧠 Архитектор (Сетка)', status: TaskStatus.IDLE, lastRun: null, nextRun: null },
    { id: 'philosopher', name: '🏛️ Философ (Ночь)', status: TaskStatus.IDLE, lastRun: null, nextRun: null },
    { id: 'evolution', name: '🧬 Эволюция (Генетика)', status: TaskStatus.IDLE, lastRun: null, nextRun: null },
    { id: 'cassandra', name: '👁️ Кассандра (Разведка)', status: TaskStatus.IDLE, lastRun: null, nextRun: null },
    { id: 'analyst', name: '📊 Аналитик (Big Data)', status: TaskStatus.IDLE, lastRun: null, nextRun: null },
];

export const loadDataVault = async (): Promise<BotState> => {
    try {
        const stored = await db.getItem<BotState>(VAULT_KEY);
        if (stored) {
            // Merge with initial state to ensure all fields exist
            const merged = { ...initialState, ...stored };
            
            return merged;
        }
    } catch (e) {
        console.error("Failed to load vault", e);
    }
    return initialState;
};

export const saveDataVault = async (state: Partial<BotState>, urgent: boolean = false) => {
    try {
        const current = await loadDataVault();
        const merged = { ...current, ...state };
        await db.setItem(VAULT_KEY, merged);
    } catch (e) {
        console.error("Failed to save vault", e);
    }
};

export const sanitizeForStorage = (obj: any): any => {
    if (!obj) return obj;
    return JSON.parse(JSON.stringify(obj, (key, value) => {
        if (value === Infinity) return null;
        if (value === -Infinity) return null;
        if (Number.isNaN(value)) return null;
        return value;
    }));
};

export const exportDataVault = async () => {
    const vault = await loadDataVault();
    const blob = new Blob([JSON.stringify(vault, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `titan_vault_export_${new Date().toISOString()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};

export const recordSystemCrash = (error: Error, context: string) => {
    const report = {
        timestamp: new Date().toISOString(),
        message: error.message,
        stack: error.stack,
        context
    };
    localStorage.setItem('CRASH_REPORT', JSON.stringify(report));
};

// Persistence Lock Logic
let isPersistenceLocked = false;
export const getPersistenceStatus = () => ({ isLocked: isPersistenceLocked });
export const resetPersistenceLock = () => { isPersistenceLocked = false; };
export const tryRecoverPersistence = async () => { isPersistenceLocked = false; return true; };
