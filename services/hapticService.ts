
/**
 * TITAN TRADING BOT - HAPTIC ENGINE (NERVOUS SYSTEM)
 * ---------------------------------------------------------
 * @module services/hapticService.ts
 * @version 2.2.1 (DIAGNOSTIC AWARE)
 * @phase Protocol Exodus
 * @description
 * Сервис тактильной отдачи.
 * UPD 2.2.1: Added getDiagnostics() for Protocol Panacea.
 * ---------------------------------------------------------
 */

let hapticsPlugin: any = null;
let capacitorCore: any = null;
let isInitialized = false;

const initHaptics = async () => {
    if (isInitialized) return;
    try {
        const [haptics, core] = await Promise.all([
            import('@capacitor/haptics').catch(() => null),
            import('@capacitor/core').catch(() => null)
        ]);
        hapticsPlugin = haptics;
        capacitorCore = core;
    } catch (e) {
        console.debug("Native haptics unavailable (Web Mode)");
    } finally {
        isInitialized = true;
    }
};

// Start init immediately
initHaptics();

const isNative = () => {
    return capacitorCore?.Capacitor?.isNativePlatform() || false;
};

// --- DIAGNOSTICS ---
export const getDiagnostics = () => {
    const hasWeb = typeof navigator !== 'undefined' && !!navigator.vibrate;
    const engine = isNative() ? 'Capacitor' : (hasWeb ? 'Web Vibration' : 'None');
    
    return {
        isInitialized,
        isNative: isNative(),
        engine,
        hasHardware: isNative() || hasWeb
    };
};

// Heavy Impact (Button Press, Modal Open)
export const tap = async () => {
    if (!isInitialized) await initHaptics();
    try {
        if (isNative() && hapticsPlugin) {
            await hapticsPlugin.Haptics.impact({ style: hapticsPlugin.ImpactStyle.Heavy });
        } else if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate(20);
        }
    } catch (e) {}
};

// Light Tick (Scroll, Slider move)
export const selection = async () => {
    if (!isInitialized) await initHaptics();
    try {
        if (isNative() && hapticsPlugin) {
            await hapticsPlugin.Haptics.selectionChanged();
        } else if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate(5);
        }
    } catch (e) {}
};

export const success = async () => {
    if (!isInitialized) await initHaptics();
    try {
        if (isNative() && hapticsPlugin) {
            await hapticsPlugin.Haptics.notification({ type: hapticsPlugin.NotificationType.Success });
        } else if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([50, 50, 50]);
        }
    } catch (e) {}
};

export const warning = async () => {
    if (!isInitialized) await initHaptics();
    try {
        if (isNative() && hapticsPlugin) {
            await hapticsPlugin.Haptics.notification({ type: hapticsPlugin.NotificationType.Warning });
        } else if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate(200);
        }
    } catch (e) {}
};

export const error = async () => {
    if (!isInitialized) await initHaptics();
    try {
        if (isNative() && hapticsPlugin) {
            await hapticsPlugin.Haptics.notification({ type: hapticsPlugin.NotificationType.Error });
        } else if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate(500);
        }
    } catch (e) {}
};

export const notify = async () => {
    if (!isInitialized) await initHaptics();
    try {
        if (isNative() && hapticsPlugin) {
            await hapticsPlugin.Haptics.impact({ style: hapticsPlugin.ImpactStyle.Medium });
        } else if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([100, 50, 100, 50, 100]);
        }
    } catch (e) {}
};
