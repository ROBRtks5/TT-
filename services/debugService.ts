
/**
 * TITAN TRADING BOT - BLACK BOX (FLIGHT RECORDER)
 * ---------------------------------------------------------
 * @module services/debugService.ts
 * @version 3.2.0 (SILENT MODE)
 * @description
 * Модуль записывает каждое решение математического ядра.
 * Хранит историю "мыслей" бота для передачи ИИ-архитектору.
 * UPD 3.2.0: Console output disabled by default for Performance.
 * ---------------------------------------------------------
 */

import { PROJECT_VERSION } from '../constants';

export interface TraceLog {
    id: number;
    timestamp: string;
    module: string;
    action: string;
    data: any;
}

// Храним последние 200 записей (хватит на ~1 час активной работы)
const MAX_TRACE_SIZE = 200; 
let traceBuffer: TraceLog[] = [];
let traceCounter = 0;

// SILENCED FOR GOLD MASTER (v43.3+)
const ENABLE_CONSOLE_LOGS = false;

/**
 * Записывает событие в Черный Ящик
 */
export const logTrace = (module: string, action: string, data: any) => {
    const entry: TraceLog = {
        id: ++traceCounter,
        timestamp: new Date().toLocaleTimeString(),
        module,
        action,
        // Делаем безопасную копию данных, чтобы они не менялись задним числом
        data: safeDeepCopy(data)
    };

    traceBuffer.unshift(entry);
    
    if (traceBuffer.length > MAX_TRACE_SIZE) {
        traceBuffer.pop();
    }
    
    if (ENABLE_CONSOLE_LOGS) {
        // Красивый вывод в консоль браузера
        console.debug(`%c[${module}] %c${action}`, 'color: #00f0ff', 'color: #fff', data);
    }
};

// Robust export
export function logSystem(module: string, message: string) {
    logTrace(module, message, { message });
}

/**
 * Вспомогательная функция для копирования объектов
 */
const safeDeepCopy = (obj: any): any => {
    try {
        if (typeof obj !== 'object' || obj === null) return obj;
        return JSON.parse(JSON.stringify(obj));
    } catch (e) {
        return { error: "Unserializable Data", raw: String(obj) };
    }
};

/**
 * Получить полный отчет для Архитектора (ИИ).
 * Теперь принимает дополнительный контекст (State/Config) для полноты картины.
 */
export const getSystemSnapshot = (extraContext: any = {}): string => {
    const report = {
        meta: {
            timestamp: new Date().toISOString(),
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Node',
            version: `BLACK_BOX_v${PROJECT_VERSION}`,
            bufferSize: traceBuffer.length
        },
        context: extraContext, // Current Settings, Ticker, etc.
        logs: traceBuffer
    };
    return JSON.stringify(report, null, 2);
};

export const clearTrace = () => {
    traceBuffer = [];
};

/**
 * EXPORT TRACE FOR UI (IntelligenceTerminal)
 */
export const getTraceLogs = (): TraceLog[] => {
    return [...traceBuffer];
};