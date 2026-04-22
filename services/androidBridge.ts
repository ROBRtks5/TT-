/**
 * TITAN TRADING BOT - ANDROID BRIDGE
 * ---------------------------------------------------------
 * @module services/androidBridge.ts
 * @version 2.2.1 (BACK EVENT)
 * @phase Protocol Exodus
 * @description
 * Мост между Web-ядром и Native-оболочкой Android/iOS.
 * Управляет системным UI, жизненным циклом и фоновым режимом (Wake Lock).
 * Refactored to use Dynamic Imports to prevent boot-blocking.
 * ---------------------------------------------------------
 */

import { LogType } from '../types';

// Lazy-loaded modules
let Capacitor: any = null;
let App: any = null;
let StatusBar: any = null;
let Style: any = null;
let Toast: any = null;

let isNative = false;
let wakeLockSentinel: WakeLockSentinel | null = null;
let isKeepAwakeDesired = false; // "Intent" to stay awake
let arePluginsLoaded = false;

/**
 * Internal: Load Plugins Dynamically
 */
const loadPlugins = async () => {
    if (arePluginsLoaded) return;
    try {
        const [coreMod, appMod, statusMod, toastMod] = await Promise.all([
            import('@capacitor/core').catch(() => null),
            import('@capacitor/app').catch(() => null),
            import('@capacitor/status-bar').catch(() => null),
            import('@capacitor/toast').catch(() => null),
        ]);

        if (coreMod) Capacitor = coreMod.Capacitor;
        if (appMod) App = appMod.App;
        if (statusMod) {
            StatusBar = statusMod.StatusBar;
            Style = statusMod.Style;
        }
        if (toastMod) Toast = toastMod.Toast;

        arePluginsLoaded = true;
    } catch (e) {
        // Silent fail in Web Mode
    }
};

/**
 * Internal: Request Screen Wake Lock
 */
const _acquireWakeLock = async () => {
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
        try {
            wakeLockSentinel = await navigator.wakeLock.request('screen');
            // console.log("[AndroidBridge] 🔦 Wake Lock Acquired (Screen ON)");
            
            // Re-acquire if released by system (e.g. tab switch)
            wakeLockSentinel.addEventListener('release', () => {
                // console.log("[AndroidBridge] 🌑 Wake Lock Released by System");
                // If we still want to be awake, try to re-acquire (mostly for visibility regain)
                if (isKeepAwakeDesired && document.visibilityState === 'visible') {
                    _acquireWakeLock();
                }
            });
        } catch (err) {
            // console.warn("[AndroidBridge] Wake Lock Failed:", err);
        }
    }
};

/**
 * Internal: Release Wake Lock
 */
const _releaseWakeLock = async () => {
    if (wakeLockSentinel) {
        try {
            await wakeLockSentinel.release();
            wakeLockSentinel = null;
            // console.log("[AndroidBridge] 😴 Wake Lock Released manually");
        } catch (err) {
            // Ignore release errors
        }
    }
};

/**
 * Инициализация моста.
 * Должна вызываться один раз при старте приложения.
 */
export const initializeBridge = async (logCallback: (type: LogType, msg: string) => void) => {
    await loadPlugins();
    
    isNative = Capacitor?.isNativePlatform() || false;

    if (!isNative) {
        // console.log("[AndroidBridge] Web Mode Detected. Partial Bridge Active (WakeLock Only).");
        // Even in Web Mode, we listen for visibility to manage WakeLock
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && isKeepAwakeDesired) {
                _acquireWakeLock();
            }
        });
        return;
    }

    // console.log("[AndroidBridge] 📲 Native Shell Detected. Initializing protocols...");
    logCallback(LogType.SYSTEM, "📲 TITAN: Android Shell Connected.");

    try {
        // 1. STATUS BAR (Верхняя панель) -> Black
        if (StatusBar && Style) {
            await StatusBar.setStyle({ style: Style.Dark });
            await StatusBar.setBackgroundColor({ color: '#050505' });
            await StatusBar.setOverlaysWebView({ overlay: false });
        }

        // 3. LIFECYCLE LISTENERS
        if (App) {
            App.addListener('appStateChange', (state: any) => {
                if (state.isActive) {
                    // console.log('[AndroidBridge] App Resumed');
                    logCallback(LogType.INFO, "📲 Shell: Система восстановлена (Resume).");
                    // Re-acquire WakeLock on resume if needed
                    if (isKeepAwakeDesired) {
                        _acquireWakeLock();
                    }
                } else {
                    // console.warn('[AndroidBridge] App Paused');
                    if (isKeepAwakeDesired) {
                        logCallback(LogType.WARNING, "⏸️ Shell: Приложение свернуто. Фоновая работа зависит от OS!");
                    }
                }
            });

            // 4. BACK BUTTON HANDLING
            App.addListener('backButton', () => {
                // Предотвращаем закрытие приложения по кнопке "Назад"
                // Emit custom event so React can close modals
                window.dispatchEvent(new CustomEvent('titan-back'));
                
                logCallback(LogType.INFO, "📲 Shell: Back Button перехвачен.");
            });
        }

    } catch (e: any) {
        console.error("[AndroidBridge] Init Failed:", e);
        logCallback(LogType.ERROR, `❌ Shell Init Error: ${e.message}`);
    }
};

/**
 * Управление режимом "Инсомния" (Wake Lock).
 * Если active = true, экран не будет гаснуть.
 */
export const setWakeLock = async (active: boolean) => {
    isKeepAwakeDesired = active;
    if (active) {
        await _acquireWakeLock();
    } else {
        await _releaseWakeLock();
    }
};

/**
 * Показывает нативное уведомление (Toast)
 */
export const showNativeToast = async (text: string) => {
    if (!arePluginsLoaded) await loadPlugins();
    if (!isNative || !Toast) return;
    
    await Toast.show({
        text: text,
        duration: 'short',
        position: 'bottom'
    });
};

/**
 * Проверка нативного режима
 */
export const isNativeMode = () => isNative;