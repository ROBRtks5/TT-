
import React, { useMemo } from 'react';
import { Position, ChartDataPoint, BotStatus, TradeHistoryEntry } from '../types';

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
    if (!Number.isFinite(val)) return '0.00';
    return new Intl.NumberFormat('ru-RU', { style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
};

const formatPrice = (val: number) => {
    if (!Number.isFinite(val)) return '0.000';
    if (val < 10) return val.toFixed(4); 
    if (val < 100) return val.toFixed(3);
    return val.toFixed(2);
};

const ReactorCore: React.FC<ReactorCoreProps> = ({ 
    position, lastPrice = 0, chartData = [], serverStopLoss, ammCapitalState,
    analysis, status, tradeHistory = []
}) => {
    const safePrice = Number.isFinite(lastPrice) ? lastPrice : 0;
    const isStale = status === BotStatus.STALE_DATA;
    
    const gridCash = ammCapitalState?.gridCash || 0;
    const gridAsset = ammCapitalState?.gridAssetQty || 0;
    
    // Safety check for analysis data
    const apzLower = analysis?.apzLower || 0;
    const apzUpper = analysis?.apzUpper || 0;
    const natr = analysis?.nATR || 0;
    const donchLower = analysis?.donchianLower || 0;
    const donchUpper = analysis?.donchianUpper || 0;

    return (
        <div className="w-full h-full flex flex-col relative px-4 py-4 bg-black overflow-hidden font-mono text-gray-300">
            {/* Background Grid - Minimalist */}
            <div className="absolute inset-0 z-0 opacity-10 pointer-events-none" style={{ backgroundImage: `linear-gradient(rgba(30,30,30,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(30,30,30,0.8) 1px, transparent 1px)`, backgroundSize: '40px 40px' }}></div>
            
            {/* Top Balances Display */}
            <div className="w-full flex justify-between z-20 mb-6 gap-4">
                <div className="bg-gray-900/40 border border-gray-800 p-3 rounded-lg flex-1">
                    <div className="text-[10px] uppercase text-cyber-cyan font-bold tracking-wider mb-1">СВОБОДНЫЙ КЭШ (BID СЕТКА)</div>
                    <div className="text-xl sm:text-2xl text-white font-black">{formatMoney(gridCash)} ₽</div>
                </div>
                
                <div className="bg-gray-900/40 border border-gray-800 p-3 rounded-lg flex-1 text-right">
                    <div className="text-[10px] uppercase text-cyber-pink font-bold tracking-wider mb-1">АКТИВ В ХОЛДЕ (ASK СЕТКА)</div>
                    <div className="text-xl sm:text-2xl text-white font-black">{gridAsset} ШТ</div>
                </div>
            </div>

            {/* Price Tape / Market HUD */}
            <div className="relative w-full mx-auto flex flex-col justify-center items-center z-10 flex-1 mb-6">
                <div className="text-xs text-gray-500 uppercase tracking-widest mb-2 font-bold focus:outline-none">MARKET TICK</div>
                <div className={`text-5xl sm:text-6xl font-black tracking-tight ${isStale ? 'text-gray-600' : 'text-yellow-400 drop-shadow-[0_0_10px_rgba(250,204,21,0.3)]'}`}>
                    {safePrice === 0 ? '---' : formatPrice(safePrice)} ₽
                </div>
                
                {position && position.entryPrice > 0 && (
                     <div className="mt-4 text-sm flex gap-4">
                        <span className="text-gray-500">AVG:</span>
                        <span className="text-gray-300 font-bold">{formatPrice(position.entryPrice)}</span>
                        <span className="text-gray-500">| PNL:</span>
                        <span className={position.currentQuantity * (safePrice - position.entryPrice) >= 0 ? 'text-green-400' : 'text-red-400'}>
                            {formatMoney(position.currentQuantity * (safePrice - position.entryPrice))} ₽
                        </span>
                     </div>
                )}
            </div>

            {/* Technical Analysis Telemetry Grid */}
            <div className="w-full grid grid-cols-2 sm:grid-cols-4 gap-2 z-20 mt-auto border-t border-gray-800/80 pt-4">
                <div className="bg-gray-900/30 p-2 rounded border border-gray-800/50">
                    <div className="text-[9px] text-gray-500 uppercase tracking-widest font-bold mb-1">APZ UPPER / LOWER</div>
                    <div className="text-xs text-blue-300 font-mono">{formatPrice(apzUpper)} / {formatPrice(apzLower)}</div>
                </div>
                <div className="bg-gray-900/30 p-2 rounded border border-gray-800/50">
                    <div className="text-[9px] text-gray-500 uppercase tracking-widest font-bold mb-1">DONCHIAN CHANNELS</div>
                    <div className="text-xs text-purple-300 font-mono">{formatPrice(donchUpper)} / {formatPrice(donchLower)}</div>
                </div>
                <div className="bg-gray-900/30 p-2 rounded border border-gray-800/50">
                    <div className="text-[9px] text-gray-500 uppercase tracking-widest font-bold mb-1">VOLATILITY (nATR)</div>
                    <div className="text-xs text-yellow-300 font-mono">{natr.toFixed(4)}%</div>
                </div>
                <div className="bg-gray-900/30 p-2 rounded border border-gray-800/50">
                    <div className="text-[9px] text-gray-500 uppercase tracking-widest font-bold mb-1">ENGINE PROTOCOL</div>
                    <div className="text-xs text-cyber-cyan font-bold">BLUE-CHIP ADAPTIVE</div>
                </div>
            </div>
            
            {isStale && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm pointer-events-none">
                    <div className="bg-[#1a0505] text-[#ff3333] px-6 py-3 border border-[#ff3333] font-bold tracking-widest animate-pulse shadow-[0_0_20px_rgba(255,51,51,0.3)] rounded-sm">⚠️ ПОТЕРЯ СВЯЗИ С БИРЖЕЙ</div>
                </div>
            )}
        </div>
    );
};

export default React.memo(ReactorCore);

