
/**
 * TITAN TRADING BOT - TERMINAL (ANDROID HARDENED)
 * ---------------------------------------------------------
 * @module components/LogPanel.tsx
 * @version 18.2.1 (RUSSIAN)
 * @phase Phase 10.3: Stability
 * ---------------------------------------------------------
 */

import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { LogEntry, LogType } from '../types';
import Card from './ui/Card';

// --- CONFIGURATION ---
const ITEM_HEIGHT = 46; 
const OVERSCAN = 5; 

// --- TYPES & HELPERS ---
type FilterType = 'ALL' | 'SYSTEM' | 'TRADE' | 'AI' | 'ERRORS';

const FILTER_OPTIONS: { id: FilterType; label: string; icon: string; }[] = [
    { id: 'ALL', label: 'Все', icon: '📋' },
    { id: 'SYSTEM', label: 'Система', icon: '⚙️' },
    { id: 'TRADE', label: 'Торги', icon: '⚖️' },
    { id: 'AI', label: 'Мозг', icon: '🧠' },
    { id: 'ERRORS', label: 'Сбои', icon: '🚨' },
];

const LogDetailsModal: React.FC<{ log: LogEntry | null; onClose: () => void }> = ({ log, onClose }) => {
    if (!log) return null;
    
    const isError = log.type === LogType.ERROR;
    const headerColor = isError ? 'text-red-500' : 'text-indigo-400';
    const borderColor = isError ? 'border-red-500/30' : 'border-gray-700';

    return createPortal(
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[9999] p-4 animate-fade-in" onClick={onClose}>
            <div className={`bg-black border-2 ${borderColor} rounded-lg shadow-[0_0_50px_rgba(0,0,0,0.8)] w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden font-sys-mono`} onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center p-4 border-b border-gray-800 bg-gray-900/50">
                    <div>
                        <h3 className={`text-lg font-black tracking-widest ${headerColor} flex items-center gap-2 uppercase`}>
                            <span>{isError ? '☢️' : '💾'}</span> {isError ? 'ОТЧЕТ ОБ ОШИБКЕ' : 'ЖУРНАЛ СОБЫТИЙ'}
                        </h3>
                        <p className="text-[10px] text-gray-500 mt-1 font-sys-mono">ID: {log.id}</p>
                    </div>
                    <button onClick={onClose} className="p-2 text-gray-400 hover:text-white text-xl">✕</button>
                </div>

                <div className="p-6 overflow-y-auto flex-1 text-xs space-y-6 custom-scrollbar select-text">
                    <div className="grid grid-cols-2 gap-4 border-b border-gray-800 pb-4">
                        <div>
                            <div className="text-[10px] uppercase text-gray-600 font-bold mb-1">ВРЕМЯ</div>
                            <div className="text-gray-300 font-sys-mono">{log.timestamp}</div>
                        </div>
                        <div>
                            <div className="text-[10px] uppercase text-gray-600 font-bold mb-1">ТИП</div>
                            <div className={`font-bold ${isError ? 'text-red-400' : 'text-blue-400'}`}>{log.type}</div>
                        </div>
                    </div>

                    <div>
                        <div className="text-[10px] uppercase text-gray-600 font-bold mb-2">СОДЕРЖИМОЕ</div>
                        <div className="bg-[#0a0a0a] p-3 rounded border-l-2 border-gray-700 text-gray-200 leading-relaxed whitespace-pre-wrap font-sys-mono">
                            {log.message}
                        </div>
                    </div>

                    {log.details ? (
                        <div>
                            <div className="flex justify-between items-end mb-2">
                                <div className="text-[10px] uppercase text-gray-600 font-bold">RAW / STACK TRACE</div>
                            </div>
                            <div className="bg-[#050505] p-3 rounded border border-gray-800 overflow-auto max-h-[300px] shadow-inner">
                                <pre className={`${isError ? 'text-red-300' : 'text-emerald-400'} font-sys-mono text-[10px] whitespace-pre-wrap`}>
                                    {JSON.stringify(log.details, null, 2)}
                                </pre>
                            </div>
                        </div>
                    ) : (
                        <div className="text-gray-700 italic text-center text-[10px] py-2">
                            -- Нет дополнительных данных --
                        </div>
                    )}
                </div>

                <div className="p-4 bg-gray-900/80 border-t border-gray-800">
                    <button 
                        onClick={onClose} 
                        className="w-full bg-gray-800 hover:bg-gray-700 text-white py-3 rounded text-xs font-bold uppercase tracking-widest transition-colors"
                    >
                        ЗАКРЫТЬ
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

// Optimization: Row Component
const LogRow = React.memo(({ log, style, index, onDetails }: { log: LogEntry; style: React.CSSProperties; index: number; onDetails: (l: LogEntry) => void }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(`[${log.timestamp}] ${log.message}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 1000);
    }, [log]);

    const msg = log.message || ""; 
    const isOdd = index % 2 !== 0;

    // ANDROID VISUALS: Solid Backgrounds prevent artifacts
    const baseBg = isOdd ? 'bg-[#080808]' : 'bg-black'; 

    const getTheme = (type: LogType, message: string) => {
        switch (type) {
            case LogType.SUCCESS: return { text: 'text-green-400', border: 'border-l-green-600' };
            case LogType.ERROR: return { text: 'text-red-400', border: 'border-l-red-600' };
            case LogType.WARNING: return { text: 'text-yellow-400', border: 'border-l-yellow-600' };
            case LogType.TRADE: return { text: 'text-cyan-400', border: 'border-l-cyan-600' };
            default: return { text: 'text-gray-400', border: 'border-l-gray-800' };
        }
    };

    const getIcon = (type: LogType) => {
        const map: Record<LogType, string> = {
            [LogType.INFO]: 'ℹ️', [LogType.SUCCESS]: '⚡', [LogType.ERROR]: '💀',
            [LogType.WARNING]: '⚠️', [LogType.SYSTEM]: '🔧', [LogType.TRADE]: '⚖️'
        };
        return map[type] || '•';
    };

    const theme = getTheme(log.type, msg);

    return (
        <div
            style={{ 
                ...style, 
                height: ITEM_HEIGHT,
                maxHeight: ITEM_HEIGHT, 
                overflow: 'hidden',
                whiteSpace: 'nowrap',
            }}
            className={`absolute w-full px-3 flex items-center border-b border-gray-900/50 ${baseBg} border-l-2 ${theme.border} transition-colors active:bg-gray-800`}
            onClick={() => onDetails(log)}
        >
            <span className="font-sys-mono text-[10px] text-gray-600 mr-3 w-14 flex-shrink-0 tabular-nums select-none opacity-70">
                {log.timestamp.split(' ')[0]} 
            </span>
            
            <span className="mr-3 text-base flex-shrink-0 select-none">
                {getIcon(log.type)}
            </span>
            
            <div className="flex-1 min-w-0 pr-2 flex items-center gap-2 overflow-hidden">
                <div className={`truncate text-xs font-bold font-sys-mono tracking-tight w-full ${theme.text}`} title={msg}>
                    {msg}
                </div>
                {log.details && (
                    <span className="text-[8px] font-black bg-gray-800 text-gray-400 px-1.5 rounded border border-gray-700 shrink-0 uppercase tracking-wider">
                        RAW
                    </span>
                )}
            </div>

            <button 
                onClick={handleCopy}
                className="p-2 text-gray-600 active:text-white focus:outline-none transition-colors"
                title="Копировать"
            >
                {copied ? (
                    <span className="text-green-500 font-bold text-xs">OK</span>
                ) : (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                )}
            </button>
        </div>
    );
}, (prev, next) => prev.log.id === next.log.id && prev.style.top === next.style.top && prev.index === next.index);

const LogPanel: React.FC<{ logs: LogEntry[] }> = ({ logs }) => {
    const [activeFilter, setActiveFilter] = useState<FilterType>('ALL');
    const [isAutoScroll, setIsAutoScroll] = useState(true);
    const [showScrollButton, setShowScrollButton] = useState(false);
    const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [containerHeight, setContainerHeight] = useState(300); 
    const scrollRafId = useRef<number | null>(null);
    
    const safeLogs = useMemo(() => {
        if (!Array.isArray(logs)) return [];
        return [...logs].sort((a, b) => b.id - a.id);
    }, [logs]);

    const displayLogs = useMemo(() => {
        const filtered = safeLogs.filter(log => {
            switch (activeFilter) {
                case 'SYSTEM': return log.type === LogType.SYSTEM || log.type === LogType.INFO;
                case 'TRADE': return log.type === LogType.TRADE || log.type === LogType.SUCCESS;
                case 'ERRORS': return log.type === LogType.ERROR || log.type === LogType.WARNING;
                case 'ALL': default: return true;
            }
        });
        return [...filtered];
    }, [safeLogs, activeFilter]);

    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;
        
        const resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(() => {
                if (container && container.clientHeight > 0) {
                    setContainerHeight(container.clientHeight);
                }
            });
        });
        resizeObserver.observe(container);
        if (container.clientHeight > 0) setContainerHeight(container.clientHeight);
        return () => resizeObserver.disconnect();
    }, []);

    const { virtualItems, totalHeight } = useMemo(() => {
        const count = displayLogs.length;
        const effectiveHeight = containerHeight > 0 ? containerHeight : 300;

        const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
        const endIndex = Math.min(count - 1, Math.ceil((scrollTop + effectiveHeight) / ITEM_HEIGHT) + OVERSCAN);

        const items = [];
        for (let i = startIndex; i <= endIndex; i++) {
            items.push({
                index: i,
                offsetTop: i * ITEM_HEIGHT,
                log: displayLogs[i]
            });
        }
        return { virtualItems: items, totalHeight: count * ITEM_HEIGHT };
    }, [scrollTop, containerHeight, displayLogs]);

    const scrollToBottom = useCallback(() => {
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = 0;
            setIsAutoScroll(true);
            setShowScrollButton(false);
        }
    }, []);

    const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        const target = e.currentTarget; 
        const currentScrollTop = target.scrollTop;

        if (scrollRafId.current) return;

        scrollRafId.current = requestAnimationFrame(() => {
            setScrollTop(currentScrollTop);
            
            const isAtTop = currentScrollTop < 50;
            
            setIsAutoScroll(isAtTop);
            setShowScrollButton(!isAtTop);
            
            scrollRafId.current = null;
        });
    }, []);

    useEffect(() => {
        if (isAutoScroll && scrollContainerRef.current) {
             scrollContainerRef.current.scrollTop = 0;
        }
    }, [displayLogs.length, isAutoScroll, activeFilter]); 

    return (
        <Card 
            className="h-[320px] lg:h-[400px] w-full border border-gray-700 shadow-2xl bg-black"
            noPadding={true}
        >
            <div className="flex flex-col h-full relative overflow-hidden rounded-lg">
                <LogDetailsModal log={selectedLog} onClose={() => setSelectedLog(null)} />

                {/* HEADER */}
                <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 bg-gray-900/95 backdrop-blur-sm z-10 shrink-0">
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-gray-300 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                            ТЕРМИНАЛ
                        </span>
                    </div>
                    
                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                        <div className="flex bg-black p-0.5 rounded-lg border border-gray-800">
                            {FILTER_OPTIONS.map((option) => (
                                <button
                                    key={option.id}
                                    onClick={() => setActiveFilter(option.id)}
                                    className={`px-3 py-1.5 rounded-md text-[10px] font-bold transition-all duration-200 flex items-center gap-1 active:scale-95 ${
                                        activeFilter === option.id 
                                            ? 'bg-gray-700 text-white shadow-sm' 
                                            : 'text-gray-500 hover:text-gray-200'
                                    }`}
                                >
                                    <span className="sm:hidden text-base">{option.icon}</span>
                                    <span className="hidden sm:inline">{option.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="flex-1 relative min-h-0 bg-[#050505] transform-gpu" style={{ contain: 'layout paint' }}>
                    <div 
                        ref={scrollContainerRef}
                        onScroll={handleScroll}
                        className="absolute inset-0 overflow-y-auto overflow-x-hidden custom-scrollbar"
                        style={{ 
                            willChange: 'scroll-position',
                            WebkitOverflowScrolling: 'touch' 
                        }}
                    >
                        {displayLogs.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-gray-600">
                                <span className="text-3xl mb-2 opacity-20 grayscale">⌨️</span>
                                <span className="text-xs font-mono tracking-widest opacity-50">НЕТ ДАННЫХ</span>
                            </div>
                        ) : (
                            <div className="relative w-full" style={{ height: totalHeight }}>
                                {virtualItems.map(({ index, offsetTop, log }) => (
                                    <LogRow 
                                        key={log.id} 
                                        log={log} 
                                        index={index}
                                        onDetails={setSelectedLog}
                                        style={{ top: offsetTop }} 
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                    
                    {showScrollButton && (
                        <div className="absolute bottom-6 right-6 z-20 animate-fade-in-up">
                            <button 
                                onClick={scrollToBottom}
                                className="bg-indigo-600/90 text-white text-[10px] font-bold py-3 px-5 rounded-full shadow-lg border border-indigo-400/50 backdrop-blur flex items-center gap-2 active:bg-indigo-700 transition-transform active:scale-95"
                            >
                                <span>⬆</span> LIVE
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </Card>
    );
};

export default React.memo(LogPanel, (prev, next) => {
    const prevLogs = Array.isArray(prev.logs) ? prev.logs : [];
    const nextLogs = Array.isArray(next.logs) ? next.logs : [];
    if (prevLogs.length !== nextLogs.length) return false;
    if (prevLogs.length === 0 && nextLogs.length === 0) return true;
    return (prevLogs[0]?.id === nextLogs[0]?.id);
});
