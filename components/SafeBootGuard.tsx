
import React, { useEffect, useState } from 'react';
import Button from './ui/Button';
import * as db from '../services/databaseService';

interface SafeBootGuardProps {
    children: React.ReactNode;
}

const BOOT_LOG_KEY = 'titan_boot_log';
const MAX_BOOTS_PER_MINUTE = 5; 

const removeSplash = () => {
    const splash = document.getElementById('titan-splash');
    if (splash) {
        splash.style.opacity = '0';
        setTimeout(() => { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 500);
    }
};

const SafeBootGuard: React.FC<SafeBootGuardProps> = ({ children }) => {
    const [isSafeMode, setIsSafeMode] = useState(false);
    
    // NON-BLOCKING INITIALIZATION
    // We default to rendering children immediately to prevent "Boot Timeout".
    // If a loop is detected, we will proactively unmount children and show Safe Mode.

    useEffect(() => {
        const checkBootLoop = () => {
            try {
                const now = Date.now();
                const rawLog = sessionStorage.getItem(BOOT_LOG_KEY);
                let bootLog: number[] = rawLog ? JSON.parse(rawLog) : [];
                
                // Filter boots older than 60s
                bootLog = bootLog.filter(ts => now - ts < 60000);
                
                // Add current boot
                bootLog.push(now);
                
                // Save back
                sessionStorage.setItem(BOOT_LOG_KEY, JSON.stringify(bootLog));
                
                if (bootLog.length > MAX_BOOTS_PER_MINUTE) {
                    console.error(`🚨 SAFE BOOT TRIGGERED: ${bootLog.length} boots in 60s.`);
                    setIsSafeMode(true);
                }
            } catch (e) {
                console.warn("Boot check failed (Storage Error)", e);
                // If storage is broken, we assume it's unsafe to proceed blindly in a potential loop context
                // but for UX, let's just log it and proceed unless it's critical.
            }
        };

        checkBootLoop();
    }, []);

    useEffect(() => {
        if (isSafeMode) {
            // Ensure splash is gone so user sees the Safe Mode screen
            removeSplash();
        }
    }, [isSafeMode]);

    const handleFactoryReset = async () => {
        if (confirm("ВНИМАНИЕ: Это удалит ВСЮ историю, настройки и память бота. Продолжить?")) {
            try {
                localStorage.clear();
                await db.clearDB();
                alert("Система очищена. Пожалуйста, обновите страницу вручную (F5).");
                setIsSafeMode(false);
            } catch (e: any) {
                alert(`Ошибка очистки: ${e.message}`);
            }
        }
    };

    const handleContinueRisk = () => {
        sessionStorage.setItem(BOOT_LOG_KEY, '[]');
        setIsSafeMode(false);
    };

    if (isSafeMode) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-black text-gray-200 font-mono p-4 animate-fade-in">
                <div className="max-w-lg w-full bg-cyber-black border-2 border-cyber-yellow rounded-xl p-8 shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-cyber-yellow animate-pulse"></div>
                    
                    <div className="flex items-center gap-4 mb-6">
                        <div className="text-4xl">🛡️</div>
                        <div>
                            <h1 className="text-2xl font-black text-white uppercase tracking-widest">SAFE MODE</h1>
                            <p className="text-cyber-yellow text-sm font-bold">BOOT LOOP DETECTED</p>
                        </div>
                    </div>
                    
                    <div className="bg-gray-900/50 p-4 rounded border border-gray-800 mb-6 text-xs text-gray-400 leading-relaxed font-mono">
                        <p className="mb-2">&gt; SYSTEM DETECTED {MAX_BOOTS_PER_MINUTE}+ CRASHES IN 60S.</p>
                        <p className="mb-2">&gt; POTENTIAL DATA CORRUPTION OR CRITICAL BUG.</p>
                        <p>&gt; RECOMMENDATION: PERFORM FACTORY RESET.</p>
                    </div>

                    <div className="flex flex-col gap-3">
                        <Button onClick={handleFactoryReset} variant="danger" className="py-4 font-bold text-sm tracking-widest uppercase">
                            ☢️ FACTORY RESET (WIPE)
                        </Button>
                        <Button onClick={handleContinueRisk} variant="secondary" className="py-3 text-[10px] tracking-widest uppercase">
                            🔄 RETRY (BYPASS GUARD)
                        </Button>
                    </div>
                    
                    <div className="mt-6 text-center text-[10px] text-gray-700 uppercase tracking-widest">
                        Protocol Diamond Bunker v3.2
                    </div>
                </div>
            </div>
        );
    }

    return <>{children}</>;
};

export default SafeBootGuard;
