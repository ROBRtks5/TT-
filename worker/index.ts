
/**
 * TITAN TRADING BOT - WORKER ABSTRACTION LAYER (SAFE MODE)
 * ---------------------------------------------------------
 * @module worker/index.ts
 * @description
 * Фабрика воркеров.
 * UPD: Forced VirtualWorker (Main Thread) to ensure 100% startup reliability and avoid path resolution issues.
 * ---------------------------------------------------------
 */

import { BotKernel } from './bot-kernel';
import { WorkerMessage, WorkerCommand } from './worker-types';
import { KernelStatus, LogType } from '../types';

// --- INTERFACE DEFINITION ---
export interface ITitanWorker {
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    postMessage(command: WorkerCommand): void;
    terminate(): void;
}

// --- IMPLEMENTATION 1: VIRTUAL WORKER (MAIN THREAD) ---
class VirtualWorker implements ITitanWorker {
    private kernel: BotKernel;
    public onmessage: ((event: MessageEvent) => void) | null = null;
    public onerror: ((event: ErrorEvent) => void) | null = null;
    private heartbeatInterval: any = null;

    constructor() {
        try {
            console.log("[VirtualWorker] Initializing Kernel in Main Thread...");
            // Инициализируем ядро, передавая функцию отправки сообщений "наружу"
            this.kernel = new BotKernel((message: WorkerMessage) => {
                // Эмулируем задержку сети/воркера для асинхронности (Zero Timeout)
                setTimeout(() => {
                    if (this.onmessage) {
                        this.onmessage({ data: message } as MessageEvent);
                    }
                }, 0);
            });

            // Симулируем успешный старт
            setTimeout(() => {
                this._emitToMain({ type: 'BOOT_STARTED' });
                this._emitToMain({ type: 'WORKER_ALIVE' });
            }, 100);

            // PROTOCOL PERISCOPE: Start Broadcasting Heartbeats directly to DOM
            this._startPeriscopeBroadcast();

        } catch (e: any) {
            console.error('[VirtualWorker] 🔥 Ошибка инициализации ядра:', e);
            setTimeout(() => {
                this._emitToMain({
                    type: 'KERNEL_STATUS_UPDATE',
                    payload: { status: KernelStatus.FAILED, error: e.message }
                });
            }, 500);
            throw e;
        }
    }

    private _startPeriscopeBroadcast() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        
        this.heartbeatInterval = setInterval(() => {
            try {
                const state = this.kernel.getState();
                const pnl = state.position ? state.position.pnl.toFixed(2) : "0.00";
                const pos = state.position ? state.position.currentQuantity.toString() : "0";
                
                // Dispatch native DOM event for Periscope HUD (bypassing React)
                const event = new CustomEvent('titan-heartbeat', {
                    detail: {
                        timestamp: Date.now(),
                        pnl: pnl,
                        position: pos,
                        status: state.status
                    }
                });
                window.dispatchEvent(event);
            } catch (e) {
                // Silent fail for broadcast
            }
        }, 1000);
    }

    public postMessage(command: WorkerCommand) {
        // Выполняем асинхронно, чтобы не блокировать UI в момент клика
        setTimeout(() => {
            try {
                this.kernel.handleCommand(command);
            } catch (e: any) {
                console.error('[VirtualWorker] Ошибка обработки команды:', e);
                this._emitToMain({
                    type: 'LOG',
                    payload: { 
                        id: Date.now(),
                        timestamp: new Date().toLocaleTimeString(), 
                        type: LogType.ERROR, 
                        message: `Kernel Crash: ${e.message}` 
                    }
                });
            }
        }, 0);
    }

    public terminate() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.kernel.dispose();
    }

    private _emitToMain(msg: WorkerMessage) {
        if (this.onmessage) {
            this.onmessage({ data: msg } as MessageEvent);
        }
    }
}

// --- FACTORY ---
export class WorkerFactory {
    /**
     * Creates the appropriate worker instance.
     * FORCED to VirtualWorker to ensure stability on all devices.
     */
    public static createWorker(): ITitanWorker {
        console.warn("[WorkerFactory] 🟡 Safe Mode: Spawning VirtualWorker (Main Thread)");
        return new VirtualWorker();
    }
}

// Legacy Export
export const TitanWorker = VirtualWorker;
