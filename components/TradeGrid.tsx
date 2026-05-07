
import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Position, BotStatus, GridOrder, TradeDirection, MachineState } from '../types';

interface TradeGridProps {
    position: Position | null;
    lastPrice: number;
    ammCapitalState?: import('../types').AmmCapitalState;
    status?: BotStatus;
    machineState?: MachineState;
    activeGridOrders: GridOrder[];
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

const getMachineStateLabel = (state?: MachineState) => {
    switch (state) {
        case MachineState.TRADING: return 'TRADING (АКТИВНО)';
        case MachineState.REBALANCING: return 'REBALANCING (РЕБАЛАНС)';
        case MachineState.EOD_SWEEP: return 'EOD SWEEP (ЗАКРЫТИЕ ДНЯ)';
        case MachineState.NIGHT_PARK: return 'NIGHT PARK (СЛИВ В TMON)';
        case MachineState.MORNING_WAKEUP: return 'WAKEUP (РАЗБЛОКИРОВКА TMON)';
        case MachineState.MORNING_SELL_ONLY: return 'MORNING (ТОЛЬКО ПРОДАЖИ)';
        case MachineState.DEEP_HOLD: return 'DEEP HOLD (ОЖИДАНИЕ ТЕЙКОВ)';
        default: return state || 'UNKNOWN';
    }
}

const TradeGrid: React.FC<TradeGridProps> = ({ 
    position, lastPrice = 0, ammCapitalState, status, machineState, activeGridOrders = []
}) => {
    const safePrice = Number.isFinite(lastPrice) ? lastPrice : 0;
    const isStale = status === BotStatus.STALE_DATA;
    
    const gridCash = ammCapitalState?.gridCash || 0;
    const gridAsset = ammCapitalState?.gridAssetQty || 0;
    
    const sells = useMemo(() => activeGridOrders.filter(o => o.direction === TradeDirection.SELL).sort((a, b) => b.price - a.price), [activeGridOrders]);
    const buys = useMemo(() => activeGridOrders.filter(o => o.direction === TradeDirection.BUY).sort((a, b) => b.price - a.price), [activeGridOrders]);

    return (
        <div className="w-full h-full flex flex-col relative px-4 py-4 bg-black overflow-hidden font-mono text-gray-300">
            {/* Background Grid - Minimalist */}
            <div className="absolute inset-0 z-0 opacity-10 pointer-events-none" style={{ backgroundImage: `linear-gradient(rgba(30,30,30,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(30,30,30,0.8) 1px, transparent 1px)`, backgroundSize: '40px 40px' }}></div>
            
            {/* Status & Balances Header */}
            <div className="w-full flex flex-col z-20 mb-2 gap-2">
                <div className="w-full flex items-center justify-between bg-gray-900/60 border border-gray-700 px-3 py-1.5 rounded-sm">
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${status === BotStatus.TRADING ? 'bg-cyber-green animate-pulse' : 'bg-gray-500'}`}></div>
                        <span className="text-[10px] sm:text-xs text-gray-400 font-bold uppercase tracking-widest">STATE:</span>
                    </div>
                    <span className="text-xs sm:text-sm font-bold text-white tracking-widest">{getMachineStateLabel(machineState)}</span>
                </div>
                <div className="w-full flex justify-between gap-2">
                    <div className="bg-gray-900/40 border border-gray-800 p-2 rounded flex-1">
                    <div className="text-[8px] sm:text-[9px] uppercase text-cyber-cyan font-bold tracking-wider mb-1">СВОБОДНЫЙ КЭШ</div>
                    <div className="text-sm sm:text-lg text-white font-black">{formatMoney(gridCash)} ₽</div>
                </div>
                
                <div className="bg-gray-900/40 border border-gray-800 p-2 rounded flex-1 text-center">
                    <div className="text-[8px] sm:text-[9px] uppercase text-cyber-purple font-bold tracking-wider mb-1">ЛИКВИДНОСТЬ (LQDT/TMON)</div>
                    <div className="text-sm sm:text-lg text-white font-black">{formatMoney(ammCapitalState?.liquidityFundValue || 0)} ₽</div>
                </div>

                <div className="bg-gray-900/40 border border-gray-800 p-2 rounded flex-1 text-right">
                    <div className="text-[8px] sm:text-[9px] uppercase text-cyber-pink font-bold tracking-wider mb-1">АКТИВ В ХОЛДЕ</div>
                    <div className="text-sm sm:text-lg text-white font-black">{gridAsset} ШТ</div>
                </div>
            </div>
            </div>

            {/* Position Summary */}
            {position && position.entryPrice > 0 && (
                <div className="w-full flex justify-between z-20 mb-4 text-xs bg-gray-900/20 py-1 px-2 border-y border-gray-800">
                    <div><span className="text-gray-500">AVG PRICE:</span> <span className="text-gray-300 font-bold">{formatPrice(position.entryPrice)} ₽</span></div>
                    <div>
                        <span className="text-gray-500">PNL:</span> 
                        <span className={`ml-1 font-bold ${position.currentQuantity * (safePrice - position.entryPrice) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {formatMoney(position.currentQuantity * (safePrice - position.entryPrice))} ₽
                        </span>
                    </div>
                </div>
            )}

            {/* THE GRID (Orderbook visual) */}
            <div className="flex-1 overflow-y-auto z-10 flex flex-col w-full pr-1">
                {/* SELL ORDERS */}
                <div className="flex flex-col gap-1 w-full mt-auto">
                    <AnimatePresence mode="popLayout">
                        {sells.map((order, idx) => (
                            <motion.div 
                                key={order.orderId} 
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, scale: 0.9, backgroundColor: '#ff0055' }}
                                transition={{ duration: 0.2 }}
                                layout
                                className="flex justify-between items-center py-1 px-2 border-l-2 border-cyber-pink bg-cyber-pink/5 hover:bg-cyber-pink/10 transition-colors text-xs sm:text-sm"
                            >
                                <span className="text-cyber-pink font-bold w-12 text-left">SELL</span>
                                <span className="text-gray-300 flex-1 text-center font-bold tracking-wider">{formatPrice(order.price)} ₽</span>
                                <span className="text-gray-400 w-16 text-right">{order.qty} шт</span>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>

                {/* MARKET TICK */}
                <div className="w-full flex justify-center items-center py-3 my-2 border-y border-yellow-500/30 bg-yellow-500/5 relative">
                    <span className="absolute left-2 text-[9px] text-yellow-500/50 uppercase font-bold hidden sm:inline-block">Текущая цена</span>
                    <span className={`text-2xl sm:text-3xl font-black tracking-tight ${isStale ? 'text-gray-600' : 'text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.4)]'}`}>
                        {safePrice === 0 ? '---' : formatPrice(safePrice)} ₽
                    </span>
                </div>

                {/* BUY ORDERS */}
                <div className="flex flex-col gap-1 w-full mb-auto">
                    <AnimatePresence mode="popLayout">
                        {buys.map((order, idx) => (
                            <motion.div 
                                key={order.orderId} 
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, scale: 0.9, backgroundColor: '#00ffee' }}
                                transition={{ duration: 0.2 }}
                                layout
                                className="flex justify-between items-center py-1 px-2 border-l-2 border-cyber-cyan bg-cyber-cyan/5 hover:bg-cyber-cyan/10 transition-colors text-xs sm:text-sm"
                            >
                                <span className="text-cyber-cyan font-bold w-12 text-left">BUY</span>
                                <span className="text-gray-300 flex-1 text-center font-bold tracking-wider">{formatPrice(order.price)} ₽</span>
                                <span className="text-gray-400 w-16 text-right">{order.qty} шт</span>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                    {buys.length === 0 && !isStale && (
                        <div className="text-center text-gray-600 text-xs py-2 italic font-mono">Сетка BUY не установлена</div>
                    )}
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

export default React.memo(TradeGrid);

