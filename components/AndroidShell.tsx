
/**
 * TITAN TRADING BOT - ANDROID SHELL COMPONENT
 * ---------------------------------------------------------
 * @module components/AndroidShell.tsx
 * @description
 * Невидимый компонент-обертка.
 * UPD: Использует Lazy Loading (динамический импорт) для подключения моста.
 * Это гарантирует, что веб-версия загрузится, даже если нативные библиотеки (Capacitor) недоступны или падают.
 * ---------------------------------------------------------
 */

import React, { useEffect } from 'react';
import { useTradingBot } from '../hooks/useTradingBot';
import { useToast } from '../context/ToastContext';
import { LogType } from '../types';

const AndroidShell: React.FC = () => {
    // Hook is just used to ensure context is ready
    const { } = useTradingBot();
    const { addToast } = useToast();

    useEffect(() => {
        let isMounted = true;
        const initNativeLayer = async () => {
            console.log("[Shell] ⏳ Попытка подключения Android Bridge (Lazy Load)...");
            
            try {
                // DYNAMIC IMPORT: The Magic Bullet.
                const androidBridge = await import('../services/androidBridge');
                if (isMounted) {
                    await androidBridge.initializeAndroidBridge();
                    
                    // WEB MODE CHECK
                    console.log("[Shell] ✅ Android Bridge Process completed.");
                }
            } catch (e: any) {
                if (isMounted) {
                    // Graceful degradation for Web
                    console.warn("[Shell] ⚠️ Native Bridge недоступен (Web Mode Active).", e.message);
                    console.debug("Это нормально, если вы запускаете бота в браузере, а не в APK.");
                }
            }
        };

        const timerId = setTimeout(initNativeLayer, 100);
        return () => {
            isMounted = false;
            clearTimeout(timerId);
        };
    }, []);

    return null; // Component renders nothing visually
};

export default AndroidShell;
