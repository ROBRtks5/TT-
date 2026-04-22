
import { useReducer, useEffect, useRef, useCallback, useState } from 'react';
import { BotState, LogType, KernelStatus, BotStatus } from '../types';
import { botReducer } from '../state/reducer';
import { initialState } from '../state/initialState';
import { WorkerCommand, WorkerMessage } from '../worker/worker-types';
import { useToast } from '../context/ToastContext';
import * as dataVaultService from '../services/dataVaultService';
import * as audioService from '../services/audioService'; 
import * as hapticService from '../services/hapticService'; 
import * as androidBridge from '../services/androidBridge'; 
import { sendNotification, requestNotificationPermission } from '../utils/notifications';
import { WorkerFactory, ITitanWorker } from '../worker/index';

const SAVE_DEBOUNCE_MS = 5000; 
const WATCHDOG_TIMEOUT_MS = 15 * 60 * 1000; // Increased to 15m for autonomy
const WORKER_INIT_TIMEOUT_MS = 30000; 
const MAX_KERNEL_RESTARTS = 5; // Increased recovery budget 

export const useTradingBot = () => {
    const [state, dispatch] = useReducer(botReducer, initialState);
    const [isKernelReady, setIsKernelReady] = useState(false);
    
    // Phoenix State
    const [kernelRestartCount, setKernelRestartCount] = useState(0);
    const isRecoveringRef = useRef(false);
    
    const workerRef = useRef<ITitanWorker | null>(null);
    const saveCallbackRef = useRef<any>(null);
    const latestStateRef = useRef<BotState>(state); 
    const { addToast } = useToast();

    const lastHeartbeatRef = useRef<number>(Date.now());
    const lastVisibilityChangeRef = useRef<number>(Date.now());
    const workerInitTimerRef = useRef<any>(null);
    const isMountedRef = useRef<boolean>(true);

    useEffect(() => {
        isMountedRef.current = true;
        return () => { isMountedRef.current = false; };
    }, []);

    // --- PROTOCOL INSOMNIA: WAKE LOCK MANAGEMENT ---
    useEffect(() => {
        androidBridge.setWakeLock(state.isBotActive);
    }, [state.isBotActive]);

    // BOOT DIAGNOSTICS: CHECK FOR CRASH REPORT
    useEffect(() => {
        try {
            const reportStr = localStorage.getItem('CRASH_REPORT');
            if (reportStr) {
                const report = JSON.parse(reportStr);
                console.error("Found Previous Crash Report:", report);
                
                setTimeout(() => {
                    addToast(`СИСТЕМА ВОССТАНОВЛЕНА ПОСЛЕ СБОЯ: ${report.message}`, LogType.WARNING);
                    hapticService.warning(); 
                }, 2000); 

                localStorage.removeItem('CRASH_REPORT');
            }
        } catch (e) {
            console.warn("Error reading crash report", e);
        }
    }, [addToast]);

    // GEMINI INIT REMOVED - PURE MATH MODE

    useEffect(() => {
        latestStateRef.current = state;
        if (state.health?.lastCheck) {
            lastHeartbeatRef.current = Date.now();
        }
    }, [state]);

    // UI WATCHDOG
    // TITAN-IRONCLAD-4: Removed entirely. Background throttling caused false positives,
    // leading to unnecessary kernel hot swaps. Worker onerror handles real crashes.
    useEffect(() => {
        // Watchdog removed
    }, []);

    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                lastVisibilityChangeRef.current = Date.now();
                if (workerRef.current) {
                    workerRef.current.postMessage({ type: 'WAKE_UP' });
                }
            }
        };
        window.addEventListener('visibilitychange', handleVisibilityChange);
        return () => window.removeEventListener('visibilitychange', handleVisibilityChange);
    }, []);

    const postCommand = useCallback((command: WorkerCommand) => {
        if (!workerRef.current) {
             addToast("ОШИБКА: Ядро не инициализировано", LogType.ERROR);
             return;
        }
        
        if (!isKernelReady && command.type !== 'IMPORT_VAULT') {
             addToast("ЗАГРУЗКА ЯДРА... Ожидайте готовности", LogType.WARNING);
             return;
        }

        workerRef.current.postMessage(command);
    }, [isKernelReady, addToast]);

    // PROTOCOL PHOENIX: HOT SWAP ENGINE
    const hotSwapKernel = useCallback(async (reason: string) => {
        if (isRecoveringRef.current) return;
        
        if (kernelRestartCount >= MAX_KERNEL_RESTARTS) {
            console.error("🔥 PHOENIX: Лимит воскрешений исчерпан. Остановка.");
            dispatch({
                type: 'SET_KERNEL_STATUS',
                payload: { status: KernelStatus.FAILED, error: `Фатальный сбой: ${reason} (Max Retries)` }
            });
            hapticService.error(); 
            return;
        }

        isRecoveringRef.current = true;
        console.warn(`♻️ PHOENIX: Инициация протокола восстановления (${kernelRestartCount + 1}/${MAX_KERNEL_RESTARTS}). Причина: ${reason}`);
        
        addToast(`СБОЙ ЯДРА: ${reason}. АВТО-ПЕРЕЗАПУСК...`, LogType.WARNING);
        audioService.playError(); 
        hapticService.warning(); 

        if (workerRef.current) {
            try { workerRef.current.terminate(); } catch(e) {}
            workerRef.current = null;
        }

        setKernelRestartCount(prev => prev + 1);
        setIsKernelReady(false);

        setTimeout(() => {
            initSequence(true); 
        }, 1000); 

    }, [kernelRestartCount, addToast]);

    const initSequence = async (isRecovery: boolean = false) => {
        try {
            if (isRecovery) {
                dispatch({ type: 'SET_KERNEL_STATUS', payload: { status: KernelStatus.LOADING_VAULT, error: null } });
            }

            const worker = WorkerFactory.createWorker();
            workerRef.current = worker;

            workerInitTimerRef.current = setTimeout(() => {
                if (!isMountedRef.current) return;
                console.error("🚨 KERNEL TIMEOUT: Engine failed to start in 30s.");
                if (!isRecoveringRef.current) { 
                     hotSwapKernel("Timeout Init");
                }
            }, WORKER_INIT_TIMEOUT_MS);

            worker.onmessage = async (event: MessageEvent<WorkerMessage>) => {
                if (!isMountedRef.current) return;
                
                try {
                    const message = event.data;
                    lastHeartbeatRef.current = Date.now();

                    if (workerInitTimerRef.current) {
                        clearTimeout(workerInitTimerRef.current);
                        workerInitTimerRef.current = null;
                    }

                    const getSavePayload = (payload: any) => ({
                        isBotActive: payload.isBotActive, // CRITICAL: Persist active status for autonomy
                        tradeHistory: payload.tradeHistory,
                        logs: payload.logs,
                        position: payload.position,
                        activeGridOrders: payload.activeGridOrders,
                        instrumentTicker: payload.instrumentTicker,
                        systemTasks: payload.systemTasks,
                        serverStopLossLevel: payload.serverStopLossLevel,
                        systemConfig: payload.systemConfig,
                        tradingStrategy: payload.tradingStrategy,
                        activeAutoStrategy: payload.activeAutoStrategy,
                        sniperState: payload.sniperState
                    });

                    const cancelPendingSave = () => {
                        if (saveCallbackRef.current) {
                            if (window.cancelIdleCallback) window.cancelIdleCallback(saveCallbackRef.current);
                            else clearTimeout(saveCallbackRef.current);
                            saveCallbackRef.current = null;
                        }
                    };

                    const scheduleSave = (state: any, immediate: boolean = false) => {
                        cancelPendingSave();
                        const data = getSavePayload(state);
                        if (immediate) {
                             dataVaultService.saveDataVault(data, true);
                        } else {
                            if (window.requestIdleCallback) {
                                saveCallbackRef.current = window.requestIdleCallback(() => {
                                    dataVaultService.saveDataVault(data, false); 
                                }, { timeout: 4000 });
                            } else {
                                saveCallbackRef.current = setTimeout(() => {
                                    dataVaultService.saveDataVault(data, false);
                                }, SAVE_DEBOUNCE_MS);
                            }
                        }
                    };

                    switch (message.type) {
                        case 'BOOT_STARTED':
                            break;

                        case 'AI_RPC_REQUEST':
                            // AI LOBOTOMY: Ignore requests or return empty
                            // We don't even process them now
                            worker.postMessage({ type: 'AI_RPC_RESPONSE', payload: { id: message.payload.id, result: {} } });
                            break;

                        case 'WORKER_ALIVE':
                            loadAndHydrateWorker(isRecovery);
                            break;
                            
                        case 'IMMEDIATE_STATE_SAVE': 
                            scheduleSave(message.payload, true);
                            break;

                        case 'REPLACE_STATE':
                            dispatch({ type: 'REPLACE_STATE', payload: message.payload });
                            scheduleSave(message.payload, false);
                            break;
                        
                        case 'PARTIAL_STATE_UPDATE':
                            dispatch({ type: 'PARTIAL_STATE_UPDATE', payload: message.payload });
                            
                            // CRITICAL: If this update contains keys we want to persist, trigger a save
                            const persistentKeys = ['isBotActive', 'status', 'tradingStrategy', 'activeAutoStrategy', 'instrumentTicker'];
                            const hasPersistentKey = Object.keys(message.payload).some(key => persistentKeys.includes(key));
                            
                            if (hasPersistentKey) {
                                // CRITICAL FIX: Build a merged state object for persistence checks
                                // because latestStateRef.current might not have updated from the dispatch yet.
                                const tempState = { ...latestStateRef.current, ...message.payload };
                                
                                // For status changes, we want relatively fast persistence
                                const immediateSave = message.payload.status === BotStatus.TRADING || 
                                                     message.payload.isBotActive === true ||
                                                     message.payload.isBotActive === false;
                                scheduleSave(tempState, immediateSave);
                            }
                            break;
                            
                        case 'LOG':
                            const logType = message.payload.type;
                            if (logType === LogType.SUCCESS) {
                                audioService.playSuccess();
                                hapticService.success();
                            } else if (logType === LogType.ERROR || logType === LogType.WARNING) {
                                audioService.playError();
                                hapticService.warning();
                            } else if (logType === LogType.TRADE) {
                                audioService.playSuccess();
                                hapticService.success();
                            }
                            
                            if (logType === LogType.SUCCESS || logType === LogType.ERROR) {
                                addToast(message.payload.message, logType);
                            }
                            dispatch({ type: 'ADD_LOG', payload: message.payload });
                            break;
                        
                        case 'SEND_NOTIFICATION':
                            sendNotification(message.payload.title, { body: message.payload.body });
                            hapticService.notify();
                            break;
                            
                        case 'KERNEL_STATUS_UPDATE':
                            const { status, error } = message.payload;
                            if (status === KernelStatus.FAILED) {
                                hotSwapKernel(error || "Unknown Kernel Failure");
                            } else {
                                dispatch({ type: 'SET_KERNEL_STATUS', payload: { status, error } });
                            }
                            break;
                    }
                } catch (msgError) {
                    console.error("CRITICAL: Failed to process worker message", msgError);
                }
            };

            worker.onerror = (event: ErrorEvent) => {
                if (!isMountedRef.current) return;
                console.error("🔥 Kernel Error (Native):", event);
                if (workerInitTimerRef.current) clearTimeout(workerInitTimerRef.current);
                hotSwapKernel(`Native Crash: ${event.message}`);
            };

            const loadAndHydrateWorker = async (isRecoveryMode: boolean) => {
                if (!isMountedRef.current) return;
                dispatch({ type: 'SET_KERNEL_STATUS', payload: { status: KernelStatus.LOADING_VAULT, error: null } });
                
                try {
                    const vault = await dataVaultService.loadDataVault();
                    const jsonVault = JSON.stringify(vault);
                    if (workerRef.current) {
                        workerRef.current.postMessage({ type: 'IMPORT_VAULT', payload: jsonVault });
                        
                        // CRITICAL FIX: Inject Keys IMMEDIATELY after vault load
                        const apiKey = localStorage.getItem('tbank-api-key');
                        const newsApiKey = localStorage.getItem('tbank-news-api-key');
                        if (apiKey) {
                            console.log("🔑 Injecting Cached Keys into Kernel...");
                            workerRef.current.postMessage({ 
                                type: 'SAVE_API_KEY', 
                                payload: { apiKey, newsApiKey: newsApiKey || undefined } 
                            });
                        }

                        setIsKernelReady(true);
                        isRecoveringRef.current = false; 
                        
                        // AUTO-RESUME: If the state says we should be active, push the START command
                        if (isRecoveryMode || vault.isBotActive) {
                            if (isRecoveryMode) {
                                addToast("♻️ Ядро успешно восстановлено.", LogType.SUCCESS);
                            } else {
                                console.log("🤖 TITAN: Авто-запуск на основе сохраненного состояния.");
                            }
                            
                            workerRef.current.postMessage({ type: 'START_BOT' });
                        }
                    }
                } catch(e: any) {
                    console.error("Failed to load vault:", e);
                    hotSwapKernel("Vault Load Fail");
                }
            };
        } catch (e: any) {
            if (!isMountedRef.current) return;
            console.error("Kernel Init Failed:", e);
            hotSwapKernel(`Init Exception: ${e.message}`);
        }
    };

    // Initial Start
    useEffect(() => {
        initSequence(false);

        return () => {
            if (workerRef.current) {
                workerRef.current.terminate();
                workerRef.current = null;
            }
            if (saveCallbackRef.current) {
                if (window.cancelIdleCallback) window.cancelIdleCallback(saveCallbackRef.current);
                else clearTimeout(saveCallbackRef.current);
            }
            if (workerInitTimerRef.current) clearTimeout(workerInitTimerRef.current);
        };
    }, []); 

    const toggleBotActive = useCallback(() => {
        if (!isKernelReady) {
             addToast("СИСТЕМА ЗАГРУЖАЕТСЯ... ПОДОЖДИТЕ", LogType.WARNING);
             hapticService.error();
             return;
        }

        if (!state.isBotActive) {
            requestNotificationPermission().catch(console.warn);
            audioService.playStartup();
            hapticService.success(); 
        } else {
            hapticService.tap();
        }
        
        if (state.isBotActive) postCommand({ type: 'STOP_BOT' });
        else postCommand({ type: 'START_BOT' });
    }, [state.isBotActive, postCommand, isKernelReady]);

    const setManualLotSize = useCallback((size: number) => {
        postCommand({ type: 'SET_MANUAL_LOT_SIZE', payload: size });
    }, [postCommand]);

    const setLeverageMultiplier = useCallback((val: number) => {
        dispatch({ type: 'SET_LEVERAGE_MULTIPLIER_OPTIMISTIC', payload: val });
        postCommand({ type: 'SET_LEVERAGE_MULTIPLIER', payload: val });
    }, [postCommand]);

    const handleResetMemory = useCallback(() => {
        dataVaultService.resetPersistenceLock(); 
        postCommand({ type: 'RESET_MEMORY' });
        hapticService.warning();
    }, [postCommand]);

    const handleImportVault = useCallback((jsonContent: string) => {
        dataVaultService.resetPersistenceLock(); 
        postCommand({ type: 'IMPORT_VAULT', payload: jsonContent });
        hapticService.success();
    }, [postCommand]);

    const handleForceSave = useCallback(() => {
        postCommand({ type: 'IMMEDIATE_STATE_SAVE', payload: state });
        hapticService.tap();
    }, [postCommand, state]);

    const handleEmergencyReset = useCallback(() => {
        postCommand({ type: 'EMERGENCY_API_RESET' });
        hapticService.error();
    }, [postCommand]);

    const handleForceExit = useCallback(() => {
        postCommand({ type: 'FORCE_CLOSE_POSITION' });
        hapticService.success(); 
    }, [postCommand]);

    const setInstrumentTicker = useCallback((ticker: string) => {
        dispatch({ type: 'SET_INSTRUMENT_TICKER', payload: ticker });
        postCommand({ type: 'SET_INSTRUMENT_TICKER', payload: ticker });
        hapticService.tap();
    }, [postCommand]);

    const handleSaveApiKey = useCallback((apiKey: string, newsApiKey?: string, geminiKey?: string) => {
        postCommand({ type: 'SAVE_API_KEY', payload: { apiKey, newsApiKey } });
        // Gemini init removed
        hapticService.success();
    }, [postCommand]);

    const updateBiosSettings = useCallback((newConfig: any) => {
        postCommand({ type: 'UPDATE_BIOS_SETTINGS', payload: newConfig });
        hapticService.tap();
    }, [postCommand]);

    return {
        ...state,
        isKernelReady,
        postCommand,
        toggleBotActive,
        setManualLotSize,
        setLeverageMultiplier,
        handleResetMemory,
        handleImportVault,
        handleForceSave,
        handleEmergencyReset,
        handleForceExit, 
        setInstrumentTicker,
        handleSaveApiKey,
        updateBiosSettings
    };
};
