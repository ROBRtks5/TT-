
import React, { useEffect, useState } from 'react';
import { PROJECT_VERSION } from '../constants';
import Button from './ui/Button';

interface SystemGuardianProps {
    children: React.ReactNode;
}

type LockReason = 'VERSION_MISMATCH' | 'MEMORY_CORRUPTION' | 'NETWORK_ERROR' | null;

const SystemGuardian: React.FC<SystemGuardianProps> = ({ children }) => {
    const [lockReason, setLockReason] = useState<LockReason>(null);
    const [memoryVersion, setMemoryVersion] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [retryCount, setRetryCount] = useState(0);
    const [forceOverride, setForceOverride] = useState(false); // BACKDOOR STATE

    const checkIntegrity = async () => {
        if (forceOverride) {
            setLoading(false);
            return;
        }

        // Увеличиваем таймаут, чтобы дать системе время на запись файла
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); 

        try {
            const response = await fetch('/TITAN_MEMORY.json', { 
                cache: 'no-store',
                signal: controller.signal 
            });
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                console.warn(`Guardian: Memory file unreachable (${response.status}). Proceeding anyway.`);
                setLoading(false);
                return; // Silent fail: don't block the UI
            }
            
            const memory = await response.json();
            
            if (!memory.meta || !memory.evolution_log) {
                 console.error("Guardian: Memory corruption detected.");
                 setLoading(false);
                 return; // Silent fail
            }

            const memVer = memory.meta.version;
            const logs = memory.evolution_log || [];
            const isVersionDocumented = logs.some((l: any) => l.version === PROJECT_VERSION);

            setMemoryVersion(memVer);

            if (memVer !== PROJECT_VERSION || !isVersionDocumented) {
                setLockReason('VERSION_MISMATCH');
            } else {
                setLockReason(null);
            }
        } catch (e: any) {
            clearTimeout(timeoutId);
            console.warn("Guardian Check Failed (Silent):", e);
            // Заглушка ошибок: не блокируем UI при сетевых сбоях
        }
        setLoading(false);
    };

    useEffect(() => {
        checkIntegrity();
    }, [retryCount]);

    const handleRetry = () => {
        setRetryCount(c => c + 1);
    };

    const handleEmergencyOverride = () => {
        if (confirm("ВНИМАНИЕ: Вы принудительно отключаете защиту целостности. Это может привести к потере данных если версии несовместимы. Продолжить?")) {
            setForceOverride(true);
            setLockReason(null);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center text-gray-500 space-y-4">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
                <div className="font-mono text-xs tracking-widest animate-pulse">SYSTEM GUARDIAN SCANNING...</div>
            </div>
        );
    }

    if (lockReason && !forceOverride) {
        return (
            <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4 font-mono select-none">
                <div className="max-w-2xl w-full bg-gray-900/50 border-2 border-red-600/60 rounded-xl p-8 shadow-[0_0_50px_rgba(220,38,38,0.2)] relative overflow-hidden backdrop-blur-sm">
                    
                    {/* Scanning Line Animation */}
                    <div className="absolute top-0 left-0 w-full h-1 bg-red-500/50 shadow-[0_0_15px_rgba(239,68,68,1)] animate-[scan_3s_ease-in-out_infinite]"></div>
                    
                    <div className="flex items-center gap-4 mb-6">
                        <div className="h-16 w-16 bg-red-900/30 rounded-lg flex items-center justify-center border border-red-500/30">
                            <span className="text-4xl">🛡️</span>
                        </div>
                        <div>
                            <h1 className="text-3xl font-black text-white tracking-tight">PROTOCOL <span className="text-red-500">VIOLATION</span></h1>
                            <p className="text-red-400 font-bold uppercase tracking-widest text-xs mt-1">System Guardian Lock Active</p>
                        </div>
                    </div>
                    
                    <div className="space-y-6 text-gray-300">
                        {lockReason === 'VERSION_MISMATCH' && (
                            <div className="bg-red-950/40 p-4 rounded-lg border-l-4 border-red-500">
                                <h3 className="font-bold text-red-200 mb-2">⛔ PROTOCOL DESYNC DETECTED</h3>
                                <p className="text-sm mb-4">
                                    Vital system components are out of phase. The Codebase and the Neural Memory must be on the same version.
                                </p>
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div className="bg-black/40 p-2 rounded">
                                        <div className="text-gray-500 text-[10px] uppercase">Code Version</div>
                                        <div className="text-white font-mono font-bold text-lg">{PROJECT_VERSION}</div>
                                    </div>
                                    <div className="bg-black/40 p-2 rounded">
                                        <div className="text-gray-500 text-[10px] uppercase">Memory Version</div>
                                        <div className="text-red-400 font-mono font-bold text-lg">{memoryVersion || 'UNKNOWN'}</div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {lockReason === 'MEMORY_CORRUPTION' && (
                            <div className="bg-yellow-900/30 p-4 rounded-lg border-l-4 border-yellow-500">
                                <h3 className="font-bold text-yellow-200">⚠️ MEMORY FILE CORRUPTED</h3>
                                <p className="text-sm">TITAN_MEMORY.json exists but has an invalid structure. 'meta' or 'evolution_log' is missing.</p>
                            </div>
                        )}

                        {lockReason === 'NETWORK_ERROR' && (
                            <div className="bg-gray-800/50 p-4 rounded-lg border-l-4 border-gray-500">
                                <h3 className="font-bold text-white">📡 CONNECTION LOST / TIMEOUT</h3>
                                <p className="text-sm">Could not verify integrity. TITAN_MEMORY.json is unreachable or the network is down.</p>
                            </div>
                        )}

                        <div className="mt-8 pt-6 border-t border-gray-800 flex gap-4 flex-col sm:flex-row">
                             <Button onClick={handleRetry} variant="primary" className="w-full py-3 shadow-lg shadow-indigo-900/20">
                                RE-SCAN INTEGRITY
                            </Button>
                            {(lockReason === 'NETWORK_ERROR' || lockReason === 'VERSION_MISMATCH') && (
                                <Button onClick={handleEmergencyOverride} variant="secondary" className="w-full sm:w-auto py-3 text-[10px] border-red-900 text-red-500 hover:bg-red-900/20">
                                    🔓 EMERGENCY OVERRIDE
                                </Button>
                            )}
                        </div>
                    </div>
                    
                    <div className="mt-6 text-center">
                        <p className="text-[10px] text-gray-600 uppercase tracking-[0.2em]">
                            Direct AI Intervention Required
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return <>{children}</>;
};

export default SystemGuardian;
