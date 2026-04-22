
import React, { useMemo, useEffect, useState } from 'react';
import { Position, ChartDataPoint, TradeDirection, BotStatus, TradeHistoryEntry } from '../types';

interface ReactorCoreProps {
    position: Position | null;
    lastPrice: number;
    chartData: ChartDataPoint[]; 
    serverStopLoss?: number | null;
    ammCapitalState?: import('../types').AmmCapitalState;
    analysis?: any; 
    status?: BotStatus;
    tradeHistory?: TradeHistoryEntry[];
}

const formatMoney = (val: number) => {
    if (!Number.isFinite(val)) return '0';
    if (Math.abs(val) < 100) {
        return new Intl.NumberFormat('ru-RU', { style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
    }
    return new Intl.NumberFormat('ru-RU', { style: 'decimal', maximumFractionDigits: 0 }).format(val);
};

const formatPrice = (val: number) => {
    if (!Number.isFinite(val)) return '0.00';
    if (val < 10) return val.toFixed(4); 
    if (val < 100) return val.toFixed(3);
    return val.toFixed(2);
};

// METEORA DLMM-STYLE VISUALIZATION
const MeteoraAmmVisualizer: React.FC<{ 
    currentPrice: number; 
    ammCapitalState?: import('../types').AmmCapitalState;
    status?: BotStatus;
    chartData?: ChartDataPoint[];
}> = ({ currentPrice, ammCapitalState, status, chartData }) => {
    const isStale = status === BotStatus.STALE_DATA;
    
    // Calculate balances
    const gridCash = ammCapitalState?.gridCash || 0;
    const gridAsset = ammCapitalState?.gridAssetQty || 0;
    const totalAsset = gridAsset;
    
    // Draw 30 bins: 15 left (bids/cash), 15 right (asks/assets)
    const BINS_PER_SIDE = 15;
    
    // Calculate BB Spread Width
    const last1mCandle = chartData && chartData.length > 0 ? chartData[chartData.length - 1] : null;
    let bbWidthPct = 0;
    if (last1mCandle && last1mCandle.bbUpper && last1mCandle.bbLower && last1mCandle.bbLower > 0) {
        bbWidthPct = ((last1mCandle.bbUpper - last1mCandle.bbLower) / last1mCandle.bbLower) * 100;
    }

    // Generate aggressive shape (height increases further from center)
    const getBinHeight = (i: number) => {
        // Curve: exponential or linear increase away from center
        const distance = Math.abs(i - BINS_PER_SIDE);
        const normalized = distance / BINS_PER_SIDE;
        return 15 + Math.pow(normalized, 1.8) * 85;
    };

    return (
        <div className="w-full h-full flex flex-col items-center justify-between relative px-2 bg-[#050505] overflow-hidden py-4">
            {/* Background Grid */}
            <div className="absolute inset-0 z-0 opacity-20 pointer-events-none" style={{ backgroundImage: `linear-gradient(rgba(30,30,30,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(30,30,30,0.8) 1px, transparent 1px)`, backgroundSize: '40px 40px', maskImage: 'radial-gradient(circle at center, transparent 30%, black 100%)' }}></div>
            
            {/* Top Balances Display */}
            <div className="w-full flex justify-between z-20 px-4">
                <div className="bg-black/60 backdrop-blur-md border border-cyber-cyan/20 p-2 sm:p-3 rounded-lg shadow-lg flex-1 mr-2 text-left">
                    <div className="text-[9px] sm:text-[10px] uppercase text-cyber-cyan font-bold tracking-wider mb-1">AMM КЭШ (BID СЕТКА)</div>
                    <div className="font-mono text-xl sm:text-2xl text-white font-black">{formatMoney(gridCash)} ₽</div>
                </div>
                
                <div className="bg-black/60 backdrop-blur-md border border-cyber-pink/20 p-2 sm:p-3 rounded-lg shadow-lg flex-1 ml-2 text-right">
                    <div className="text-[9px] sm:text-[10px] uppercase text-cyber-pink font-bold tracking-wider mb-1">РЕЗЕРВ АКТИВА (ASK СЕТКА)</div>
                    <div className="font-mono text-xl sm:text-2xl text-white font-black">{totalAsset} ШТ</div>
                </div>
            </div>

            {/* DLMM Histogram & X-Axis - Center Aligned */}
            <div className="relative w-full max-w-4xl mx-auto h-[180px] sm:h-[220px] flex flex-col justify-end z-10 my-4 px-2">
                
                {/* Bins Container */}
                <div className="flex items-end gap-[1px] sm:gap-[2px] w-full h-full relative">
                    {Array.from({ length: BINS_PER_SIDE * 2 + 1 }).map((_, i) => {
                        const isCenter = i === BINS_PER_SIDE;
                        const isLeft = i < BINS_PER_SIDE;
                        const heightPct = isCenter ? 3 : getBinHeight(i);
                        
                        // Colors: Emerald/Cyan for Bids (Cash ready to buy drops), Pink for Asks (Assets ready to sell pumps)
                        let colorClass = isLeft ? 'bg-[#00f2fe] shadow-[0_0_10px_rgba(0,242,254,0.3)]' : 'bg-[#fe0979] shadow-[0_0_10px_rgba(254,9,121,0.3)]';
                        if (isCenter) colorClass = 'bg-[#fcee0a]'; // Current price cursor
                        if (isStale) colorClass = 'bg-gray-800';

                        // Opacity fades slightly towards center
                        const distance = Math.abs(i - BINS_PER_SIDE);
                        const opacity = isCenter ? 1 : 0.4 + (distance / BINS_PER_SIDE) * 0.6;

                        return (
                            <div 
                                key={i} 
                                className={`flex-1 rounded-t border-t border-white/20 transition-all duration-300 ${colorClass}`}
                                style={{ 
                                    height: `${heightPct}%`, 
                                    opacity: isStale ? 0.3 : opacity,
                                    transform: isCenter ? 'scaleY(4)' : 'none',
                                    transformOrigin: 'bottom',
                                    zIndex: isCenter ? 10 : 1
                                }}
                            ></div>
                        );
                    })}
                </div>

                {/* Horizontal Axis Line */}
                <div className="w-full h-[2px] bg-gray-800/80 relative z-0"></div>

                {/* Current Price Marker */}
                <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center z-20">
                    <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-b-[8px] border-transparent border-b-[#fcee0a] mb-0.5 shadow-[0_-2px_10px_rgba(252,238,10,0.8)] filter drop-shadow-[0_-2px_4px_rgba(252,238,10,0.5)]"></div>
                    <div className="px-3 py-1 bg-[#fcee0a] text-black font-black font-mono text-sm sm:text-base border border-yellow-300 rounded-sm shadow-[0_4px_15px_rgba(252,238,10,0.4)] relative whitespace-nowrap">
                        <div className="absolute inset-0 bg-white/30 mix-blend-overlay"></div>
                        {currentPrice === 0 ? 'AWAITING TICK' : formatPrice(currentPrice)}
                    </div>
                </div>
            </div>

            {/* Protocols & Market Width */}
            <div className="w-full flex justify-between items-end border-t border-gray-800/80 pt-4 px-4 z-20">
                <div className="flex flex-col">
                    <span className="text-[8px] sm:text-[9px] text-gray-500 uppercase tracking-widest font-semibold mb-0.5">ПРОТОКОЛ DLMM</span>
                    <span className="text-xs sm:text-sm font-bold text-cyber-cyan filter drop-shadow-[0_0_5px_rgba(0,255,255,0.5)]">HYBRID ENGINE ON</span>
                </div>
                
                <div className="text-right px-2 py-1.5 bg-gray-900/30 rounded border border-gray-800/50">
                    <div className="text-[8px] sm:text-[9px] text-cyber-yellow uppercase tracking-widest font-bold mb-0.5">ШИРИНА СПРЕДА (BB)</div>
                    <div className="text-[10px] sm:text-xs font-mono text-yellow-300 drop-shadow-[0_0_5px_rgba(255,255,0,0.3)]">
                        {bbWidthPct > 0 ? `${bbWidthPct.toFixed(2)}%` : '---'}
                    </div>
                </div>
            </div>
            
            {isStale && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm pointer-events-none">
                    <div className="bg-[#1a0505] text-[#ff3333] px-6 py-3 border border-[#ff3333] font-bold tracking-widest animate-pulse shadow-[0_0_20px_rgba(255,51,51,0.3)] rounded-sm">⚠️ ПОТЕРЯ СВЯЗИ С ЯДРОМ</div>
                </div>
            )}
        </div>
    );
};

// --- MAIN REACTOR (Now exclusively AMM) ---
const ReactorCore: React.FC<ReactorCoreProps> = ({ 
    position, lastPrice = 0, chartData = [], serverStopLoss, ammCapitalState,
    analysis, status, tradeHistory = []
}) => {
    const safePrice = Number.isFinite(lastPrice) ? lastPrice : 0;

    return (
        <MeteoraAmmVisualizer 
            currentPrice={safePrice} 
            ammCapitalState={ammCapitalState} 
            status={status} 
            chartData={chartData} 
        />
    );
};

export default React.memo(ReactorCore);

