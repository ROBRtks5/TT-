
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

import React, { useEffect, useState } from 'react';
import { useTradingBot } from '../hooks/useTradingBot';
import { useToast } from '../context/ToastContext';
import { LogType } from '../types';
import { PROJECT_VERSION } from '../constants';

const AndroidShell: React.FC = () => {
    const { isBotActive } = useTradingBot();
    const { addToast } = useToast();
    const [showExitConfirm, setShowExitConfirm] = useState(false);

    useEffect(() => {
        let isMounted = true;
        const initNativeLayer = async () => {
            console.debug("[Shell] ⏳ Попытка подключения Android Bridge (Lazy Load)...");
            
            try {
                // DYNAMIC IMPORT: The Magic Bullet.
                const androidBridge = await import('../services/androidBridge');
                if (isMounted) {
                    await androidBridge.initializeAndroidBridge();
                    
                    // WEB MODE CHECK
                    console.debug("[Shell] ✅ Android Bridge Process completed.");
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

        const handleHardwareBack = () => {
            setShowExitConfirm(true);
        };
        window.addEventListener('titan-hardware-back', handleHardwareBack);

        return () => {
            isMounted = false;
            clearTimeout(timerId);
            window.removeEventListener('titan-hardware-back', handleHardwareBack);
        };
    }, []);

    // Toggle Wake Lock on Android based on bot status
    useEffect(() => {
        import('../services/androidBridge').then(bridge => {
            bridge.setWakeLock(!!isBotActive);
        }).catch(() => {});
    }, [isBotActive]);

    const confirmExit = async () => {
        try {
            const { App } = await import('@capacitor/app');
            App.exitApp();
        } catch (e) {
            console.error("Failed to exit app", e);
        }
    };

    if (showExitConfirm) {
        return (
            <div className="fixed inset-0 z-[9999999] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
                <div className="border border-cyber-pink/50 bg-cyber-dark/95 p-6 max-w-sm w-full relative overflow-hidden shadow-[0_0_30px_rgba(255,0,60,0.2)]">
                    <div className="absolute top-0 left-0 w-full h-1 bg-cyber-pink"></div>
                    <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-cyber-pink/80"></div>
                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-cyber-pink/80"></div>
                    
                    <h2 className="text-2xl font-black text-cyber-pink uppercase tracking-widest mb-2 flex items-center gap-2">
                        <span className="animate-pulse">⚠️</span> Внимание
                    </h2>
                    
                    <p className="font-mono text-gray-300 text-sm mb-8 leading-relaxed">
                        Вы действительно хотите выйти из <span className="text-cyber-cyan font-bold">VORTEX v{PROJECT_VERSION.split(' ')[0]}</span>? <br/><br/>
                        Робот продолжит работу потока в фоне, но локальное соединение будет разорвано.
                    </p>
                    
                    <div className="flex justify-end gap-4">
                        <button 
                            onClick={() => setShowExitConfirm(false)}
                            className="px-6 py-2 border border-cyber-cyan text-cyber-cyan font-mono text-sm hover:bg-cyber-cyan/10 transition-colors uppercase tracking-wider"
                        >
                            Отмена
                        </button>
                        <button 
                            onClick={confirmExit}
                            className="px-6 py-2 bg-cyber-pink text-black font-bold font-mono text-sm hover:bg-cyber-pink/80 transition-colors uppercase tracking-wider"
                        >
                            Выйти
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return null; // Component renders nothing visually normally
};

export default AndroidShell;
