
/**
 * TITAN OS: INTELLIGENCE TERMINAL (ZONE 3)
 * ---------------------------------------------------------
 * @module components/IntelligenceTerminal.tsx
 * @version 6.0.0 (NEURAL ARCHIVIST)
 * ---------------------------------------------------------
 */

import React, { useEffect, useState, useMemo, useRef } from 'react';
import { LogEntry, LogType, TradeHistoryEntry } from '../types';
import HeartbeatStrip from './ui/HeartbeatStrip';
import BrainMap from './ui/BrainMap';
import { streamManager } from '../services/streamManager';
import * as debugService from '../services/debugService'; 

interface IntelligenceTerminalProps {
    logs: LogEntry[];
    telemetry?: { rsi: number | null; trendStrength: number };
    analysis?: any;
    tradeHistory?: TradeHistoryEntry[];
}

const IntelligenceTerminal: React.FC<IntelligenceTerminalProps> = ({ 
    logs, 
    telemetry, 
    analysis, 
    tradeHistory = [] 
}) => {
    const [lastTick, setLastTick] = useState(Date.now());
    const [viewMode, setViewMode] = useState<'LOGS' | 'TRACE' | 'NET' | 'HIST'>('LOGS');
    const [traceLogs, setTraceLogs] = useState<debugService.TraceLog[]>([]);
    
    const scrollRef = useRef<HTMLDivElement>(null);
    const [autoScroll, setAutoScroll] = useState(true);
    const scrollFrameRef = useRef<number | null>(null);

    // Refresh trace logs periodically if mode is active
    useEffect(() => {
        if (viewMode === 'TRACE') {
            const interval = setInterval(() => {
                setTraceLogs(debugService.getTraceLogs());
            }, 1000);
            return () => clearInterval(interval);
        }
    }, [viewMode]);

    useEffect(() => {
        // TITAN-IRONCLAD-5 (Omni-Stability): Removed direct streamManager.on('trades') 
        // listener that caused massive 50fps React re-renders of the entire IntelligenceTerminal,
        // which lead to mobile browser CPU exhaustion and unprompted auto-reloads.
        // Instead, we just passively blink heartbeats using CSS or a local slow timer.
        const interval = setInterval(() => {
            setLastTick(Date.now());
        }, 1500);
        return () => clearInterval(interval);
    }, []);

    const handleScroll = () => {
        if (!scrollRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
        const isAtBottom = (scrollHeight - scrollTop - clientHeight) < 20;
        if (autoScroll !== isAtBottom) setAutoScroll(isAtBottom);
    };

    const displayLogs = useMemo(() => {
        if (!Array.isArray(logs)) return [];
        // Logs are stored newest-first in the reducer, reverse them to show older at top, newer at bottom for chat-like interface
        return [...logs].slice(0, 50).reverse();
    }, [logs]);

    const displayHistory = useMemo(() => {
        // Show trades and important events
        if (!Array.isArray(tradeHistory)) return [];
        // tradeHistory is stored newest-first, we just want to filter and slice.
        return tradeHistory
            .filter(t => t.type === 'TRADE')
            .slice(0, 50);
    }, [tradeHistory]);

    useEffect(() => {
        // Only autoscroll for Logs mode
        if (viewMode === 'LOGS' && autoScroll && scrollRef.current) {
            if (scrollFrameRef.current) cancelAnimationFrame(scrollFrameRef.current);
            scrollFrameRef.current = requestAnimationFrame(() => {
                if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            });
        }
        return () => {
            if (scrollFrameRef.current) cancelAnimationFrame(scrollFrameRef.current);
        };
    }, [displayLogs, autoScroll, viewMode]);

    const getLogStyle = (type: LogType) => {
        switch (type) {
            case LogType.ERROR: return 'text-red-400 bg-red-900/10 border-l-2 border-red-500';
            case LogType.WARNING: return 'text-yellow-400 bg-yellow-900/10 border-l-2 border-yellow-500';
            case LogType.SUCCESS: return 'text-emerald-400 border-l-2 border-emerald-500';
            case LogType.TRADE: return 'text-cyan-300 font-bold bg-cyan-900/10 border-l-2 border-cyan-500';
            default: return 'text-gray-400 border-l-2 border-gray-700';
        }
    };

    const handleClearTrace = () => {
        debugService.clearTrace();
        setTraceLogs([]);
    };

    // Calculate Neural Metrics
    const neuralData = useMemo(() => {
        const rsi = telemetry?.rsi || 50;
        const trend = telemetry?.trendStrength || 50;
        const vol = analysis?.predictedVolatility === 'HIGH' ? 80 : (analysis?.predictedVolatility === 'LOW' ? 20 : 50);
        const conv = (analysis?.confidence || 0) * 100;
        const risk = 50; // default placeholder
        
        return { rsi, trend, vol, conv, risk };
    }, [telemetry, analysis]);

    return (
        <div className="w-full h-full flex flex-col bg-[#050505] border-t border-gray-800">
            {/* HEADER */}
            <div className="h-6 flex items-center justify-between bg-black px-2 border-b border-gray-800 relative overflow-hidden shrink-0">
                <div className="absolute inset-0 opacity-20 pointer-events-none">
                    <HeartbeatStrip lastTick={lastTick} height={24} />
                </div>
                <span className="text-[10px] font-bold text-gray-500 z-10 tracking-widest pl-1 uppercase">
                    {viewMode} NODE
                </span>
                
                <div className="flex gap-1 z-10">
                    <button 
                        onClick={() => setViewMode('LOGS')}
                        className={`text-[9px] px-2 py-0.5 rounded border uppercase font-bold transition-all ${viewMode === 'LOGS' ? 'bg-cyber-cyan text-black border-cyber-cyan' : 'bg-transparent text-gray-600 border-gray-700 hover:text-white'}`}
                    >
                        LOGS
                    </button>
                    <button 
                        onClick={() => setViewMode('HIST')}
                        className={`text-[9px] px-2 py-0.5 rounded border uppercase font-bold transition-all ${viewMode === 'HIST' ? 'bg-cyber-green text-black border-cyber-green' : 'bg-transparent text-gray-600 border-gray-700 hover:text-white'}`}
                    >
                        📜 HIST
                    </button>
                    <button 
                        onClick={() => setViewMode('NET')}
                        className={`text-[9px] px-2 py-0.5 rounded border uppercase font-bold transition-all ${viewMode === 'NET' ? 'bg-cyber-purple text-white border-cyber-purple' : 'bg-transparent text-gray-600 border-gray-700 hover:text-white'}`}
                    >
                        🧠 NET
                    </button>
                    <button 
                        onClick={() => setViewMode('TRACE')}
                        className={`text-[9px] px-2 py-0.5 rounded border uppercase font-bold transition-all ${viewMode === 'TRACE' ? 'bg-cyber-yellow text-black border-cyber-yellow' : 'bg-transparent text-gray-600 border-gray-700 hover:text-white'}`}
                    >
                        TRC
                    </button>
                    
                    {viewMode === 'TRACE' && (
                        <button onClick={handleClearTrace} className="text-[9px] px-2 py-0.5 rounded border border-red-900/50 text-red-500 hover:bg-red-900/20" title="Clear">
                            🗑️
                        </button>
                    )}
                </div>
            </div>

            {/* CONTENT */}
            <div 
                ref={scrollRef}
                onScroll={handleScroll}
                className="flex-1 overflow-y-auto custom-scrollbar p-1 space-y-0.5 font-mono text-xs relative"
            >
                {viewMode === 'LOGS' && (
                    displayLogs.map((log, i) => (
                        <div key={`${log.id}-${i}`} className={`py-1 px-2 leading-tight break-words ${getLogStyle(log.type)} ${i % 2 === 0 ? 'bg-white/0' : 'bg-white/[0.02]'}`}>
                            <span className="opacity-50 text-[10px] mr-2">{log.timestamp.split(' ')[0]}</span>
                            {log.message}
                        </div>
                    ))
                )}

                {viewMode === 'HIST' && (
                    displayHistory.length === 0 ? (
                        <div className="text-gray-600 text-center italic mt-4">Archive empty.</div>
                    ) : (
                        displayHistory.map((trade, index) => {
                            const isProfit = trade.pnl > 0;
                            const isLoss = trade.pnl < 0;
                            const isBuy = !trade.pnl && trade.type === 'TRADE'; // Usually Buy has 0 realized PnL in this model until exit
                            
                            // Determine visual style
                            let border = 'border-gray-800';
                            let text = 'text-gray-300';
                            let bg = 'bg-transparent';
                            let icon = '•';

                            if (trade.pnl > 0) { // Win Exit
                                border = 'border-cyber-green';
                                text = 'text-cyber-green';
                                bg = 'bg-cyber-green/10';
                                icon = '💰';
                            } else if (trade.pnl < 0) { // Loss Exit
                                border = 'border-cyber-pink';
                                text = 'text-cyber-pink';
                                bg = 'bg-cyber-pink/10';
                                icon = '🩸';
                            } else { // Entry (Buy)
                                border = 'border-cyber-cyan';
                                text = 'text-cyber-cyan';
                                bg = 'bg-cyber-cyan/10';
                                icon = '⚡';
                            }

                            return (
                                <div key={`hist-${trade.id ? trade.id : trade.exitTime}-${index}`} className={`flex justify-between items-center p-2 mb-1 rounded border-l-2 ${border} ${bg}`}>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm">{icon}</span>
                                            <span className={`font-bold ${text}`}>
                                                {trade.pnl !== 0 ? (trade.pnl > 0 ? 'ПРОФИТ' : 'УБЫТОК') : 'ВХОД'}
                                            </span>
                                        </div>
                                        <div className="text-[10px] text-gray-500 font-mono">
                                            {new Date(trade.exitTime).toLocaleTimeString()} • {trade.quantity} шт @ {trade.entryPrice.toFixed(2)}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className={`text-sm font-black ${text}`}>
                                            {trade.pnl !== 0 ? (trade.pnl > 0 ? '+' : '') + trade.pnl.toFixed(2) : trade.exitPrice.toFixed(2)}
                                        </div>
                                        <div className="text-[9px] text-gray-600">
                                            {trade.pnl !== 0 ? 'PnL' : 'Цена'}
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )
                )}

                {viewMode === 'TRACE' && (
                    traceLogs.length === 0 ? (
                        <div className="text-gray-600 text-center italic mt-4">Trace buffer empty.</div>
                    ) : (
                        traceLogs.slice(0, 100).map((trace, index) => (
                            <div key={`trace-${trace.id}-${index}`} className="py-1 px-2 border-l-2 border-gray-800 hover:bg-gray-900/50">
                                <div className="flex justify-between text-[10px] text-gray-500">
                                    <span>{new Date(trace.timestamp).toLocaleTimeString()}</span>
                                    <span className="font-bold text-cyber-cyan">{trace.module}</span>
                                </div>
                                <div className="text-gray-300 font-bold">{trace.action}</div>
                                <div className="text-[10px] text-gray-500 whitespace-pre-wrap font-mono mt-0.5 pl-2 border-l border-gray-700/50">
                                    {JSON.stringify(trace.data)}
                                </div>
                            </div>
                        ))
                    )
                )}

                {viewMode === 'NET' && (
                    <div className="w-full h-full flex items-center justify-center p-2 bg-[#080808]">
                        <BrainMap 
                            rsi={neuralData.rsi}
                            trendScore={neuralData.trend}
                            volatility={neuralData.vol}
                            conviction={neuralData.conv}
                            risk={neuralData.risk}
                        />
                        {/* Overlay Stats */}
                        <div className="absolute top-2 left-2 text-[9px] text-gray-500 font-mono">
                            <div>RSI: {neuralData.rsi.toFixed(1)}</div>
                            <div>VOL: {neuralData.vol}%</div>
                        </div>
                        <div className="absolute bottom-2 right-2 text-[9px] text-gray-500 font-mono text-right">
                            <div>CONF: {neuralData.conv.toFixed(0)}%</div>
                            <div className={neuralData.risk > 50 ? 'text-red-500' : 'text-green-500'}>RISK: {neuralData.risk}%</div>
                        </div>
                    </div>
                )}
                
                <div className="h-2"></div>
            </div>
        </div>
    );
};

export default React.memo(IntelligenceTerminal);
