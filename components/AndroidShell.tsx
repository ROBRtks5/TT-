
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
        const initNativeLayer = async () => {
            console.log("[Shell] ⏳ Попытка подключения Android Bridge (Lazy Load)...");
            
            try {
                // DYNAMIC IMPORT: The Magic Bullet.
                const androidBridge = await import('../services/androidBridge');
                
                const bridgeLogger = (type: LogType, message: string) => {
                    console.log(`[Bridge:${type}] ${message}`);
                };

                await androidBridge.initializeBridge(bridgeLogger);
                
                // WEB MODE CHECK
                if (!androidBridge.isNativeMode()) {
                    console.log("[Shell] Web Mode confirmed.");
                    // Notify user they are in Web Simulation
                    setTimeout(() => {
                        addToast("СРЕДА: WEB BROWSER. ЭМУЛЯЦИЯ NATIVE ВКЛЮЧЕНА.", LogType.INFO);
                    }, 2000);
                } else {
                    console.log("[Shell] ✅ Android Bridge успешно интегрирован.");
                }
                
            } catch (e: any) {
                // Graceful degradation for Web
                console.warn("[Shell] ⚠️ Native Bridge недоступен (Web Mode Active).", e.message);
                console.debug("Это нормально, если вы запускаете бота в браузере, а не в APK.");
            }
        };

        // Запускаем инициализацию асинхронно, давая React время на отрисовку
        setTimeout(initNativeLayer, 100);
    }, []);

    return null; // Component renders nothing visually
};

export default AndroidShell;
