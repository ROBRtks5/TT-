import { App } from '@capacitor/app';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { Capacitor } from '@capacitor/core';
import * as dataVaultService from './dataVaultService';

/**
 * Initializes Android-specific plugins and behaviors.
 * Keeps the application running in the background and keeps the screen awake.
 */
export const setWakeLock = async (isActive: boolean) => {
    if (!Capacitor.isNativePlatform()) return;
    try {
        if (isActive) {
            await KeepAwake.keepAwake();
            console.log('[AndroidBridge] WAKE_LOCK enabled (Bot Active).');
        } else {
            await KeepAwake.allowSleep();
            console.log('[AndroidBridge] WAKE_LOCK disabled (Bot Idle).');
        }
    } catch (e) {
        console.error('[AndroidBridge] Failed to toggle WakeLock:', e);
    }
};

export const initializeAndroidBridge = async () => {
    if (!Capacitor.isNativePlatform()) {
        console.log('[AndroidBridge] Running in web mode. Skipping native Android initialization.');
        return;
    }

    try {
        console.log('[AndroidBridge] Native platform detected. Initializing specific protocols...');

        // 1. Keep Awake (Wake Lock)
        // This stops the screen from dimming/sleeping when the app is in the foreground.
        await KeepAwake.keepAwake();
        console.log('[AndroidBridge] WAKE_LOCK acquired successfully.');

        // 2. Background Task Execution Hooks
        // While genuine backgrounding under Android requires specialized services, 
        // Capacitor App plugin allows us to listen to State Changes and take action.
        App.addListener('appStateChange', ({ isActive }) => {
            console.log(`[AndroidBridge] App state changed. isActive: ${isActive}`);
            if (!isActive) {
                // The app has gone to the background. 
                console.log('[AndroidBridge] App sent to background. Core engine continues running if allowed by OS.');
            } else {
                console.log('[AndroidBridge] App returned to foreground.');
            }
        });

        // 3. Optional: Back Button Override (prevent accidental exit)
        App.addListener('backButton', ({ canGoBack }) => {
            console.log('[AndroidBridge] Back button pressed. Triggering custom exit modal.');
            // Implementation: We don't exit the app on back button to prevent the user from killing the bot by accident.
            const event = new CustomEvent('titan-hardware-back', { detail: { canGoBack } });
            window.dispatchEvent(event);
        });

        console.log('[AndroidBridge] Initialization complete.');
    } catch (error) {
        console.error('[AndroidBridge] Error during initialization:', error);
    }
};
