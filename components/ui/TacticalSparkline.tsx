
import React, { useMemo } from 'react';
import { ChartDataPoint, TradeHistoryEntry } from '../../types';

interface TacticalSparklineProps {
    data: ChartDataPoint[];
    color?: string;
    nextBuyLevel?: number | null;
    takeProfitLevel?: number | null;
    pocLevel?: number | null; // NEW: Point of Control
    trades?: TradeHistoryEntry[];
    className?: string;
}

const TacticalSparkline: React.FC<TacticalSparklineProps> = ({ 
    data, 
    color = "text-gray-600",
    nextBuyLevel,
    takeProfitLevel,
    pocLevel,
    trades = [],
    className = ""
}) => {
    
    // --- GEOMETRY ENGINE ---
    const geometry = useMemo(() => {
        if (!data || !Array.isArray(data) || data.length < 2) return null;
        
        // 1. Slice & Sanitize
        const slice = data.slice(-60); // Last 60 points (~1 hour)
        const prices = slice.map(d => d.price).filter(p => Number.isFinite(p));
        
        if (prices.length < 2) return null;

        const currentPrice = prices[prices.length - 1];
        
        // Get Time Domain
        const minTime = slice[0].time;
        const maxTime = slice[slice.length - 1].time;
        const timeRange = maxTime - minTime || 1;

        // 2. Determine Scale (Auto-Zoom)
        let min = Math.min(...prices);
        let max = Math.max(...prices);
        
        // Add Levels to scale if they are reasonable
        const rangeTolerance = currentPrice * 0.05;
        
        const includeInScale = (val: number | null | undefined) => {
            if (val && val > 0 && Math.abs(currentPrice - val) < rangeTolerance) {
                min = Math.min(min, val);
                max = Math.max(max, val);
            }
        };

        includeInScale(nextBuyLevel);
        includeInScale(takeProfitLevel);
        includeInScale(pocLevel); // Include POC in scaling

        const range = (max - min) || 1;
        const paddedMin = min - (range * 0.1);
        const paddedMax = max + (range * 0.1);
        const paddedRange = paddedMax - paddedMin;

        // 3. Coordinate Mappers
        const getCoord = (p: number, i: number, length: number) => {
            const x = (i / (length - 1)) * 100;
            const y = 100 - (((p - paddedMin) / paddedRange) * 100);
            return { x, y };
        };

        const getLevelY = (level: number) => {
            return 100 - (((level - paddedMin) / paddedRange) * 100);
        };
        
        const getTimeX = (time: number) => {
            const relativeTime = Math.max(0, Math.min(timeRange, time - minTime));
            return (relativeTime / timeRange) * 100;
        };

        // 4. Bezier Smoothing
        let d = `M ${getCoord(prices[0], 0, prices.length).x} ${getCoord(prices[0], 0, prices.length).y}`;
        for (let i = 1; i < prices.length; i++) {
            const curr = getCoord(prices[i], i, prices.length);
            const prev = getCoord(prices[i-1], i-1, prices.length);
            const cp1x = prev.x + (curr.x - prev.x) / 2;
            const cp1y = prev.y;
            const cp2x = prev.x + (curr.x - prev.x) / 2;
            const cp2y = curr.y;
            d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${curr.x} ${curr.y}`;
        }

        const fillD = `${d} L 100,120 L 0,120 Z`;
        const lastPoint = getCoord(currentPrice, prices.length - 1, prices.length);

        // 5. Execution Markers
        // Filter trades visible in current window
        const markers = trades
            .filter(t => t.exitTime >= minTime && t.exitTime <= maxTime)
            .map(t => {
                const x = getTimeX(t.exitTime);
                // Use entry price for visualization accuracy
                const y = 100 - (((t.entryPrice - paddedMin) / paddedRange) * 100);
                const isBuy = t.decisionReason?.includes('Покупка') || t.decisionReason?.includes('Вход');
                const isWin = t.pnl > 0;
                
                return {
                    x, y, isBuy, isWin, pnl: t.pnl
                };
            });

        return {
            linePath: d,
            fillPath: fillD,
            lastPoint,
            buyY: nextBuyLevel && nextBuyLevel > 0 ? getLevelY(nextBuyLevel) : null,
            tpY: takeProfitLevel && takeProfitLevel > 0 ? getLevelY(takeProfitLevel) : null,
            pocY: pocLevel && pocLevel > 0 ? getLevelY(pocLevel) : null,
            markers
        };

    }, [data, nextBuyLevel, takeProfitLevel, pocLevel, trades]);

    if (!geometry) return null;

    return (
        <svg viewBox="0 0 100 100" className={`w-full h-full overflow-visible ${className}`} preserveAspectRatio="none">
            <defs>
                <linearGradient id="sparkGrad" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="currentColor" stopOpacity="0.3"/>
                    <stop offset="100%" stopColor="currentColor" stopOpacity="0"/>
                </linearGradient>
                <filter id="glowPoint">
                    <feGaussianBlur stdDeviation="2.5" result="coloredBlur"/>
                    <feMerge>
                        <feMergeNode in="coloredBlur"/>
                        <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                </filter>
            </defs>

            {/* LEVEL: POINT OF CONTROL (HYPERION) */}
            {geometry.pocY !== null && geometry.pocY >= 0 && geometry.pocY <= 100 && (
                <g>
                    <line x1="0" y1={geometry.pocY} x2="100" y2={geometry.pocY} stroke="#bd00ff" strokeWidth="0.8" strokeDasharray="1 1" opacity="0.8" vectorEffect="non-scaling-stroke" />
                    <text x="2" y={geometry.pocY - 2} fontSize="4" fill="#bd00ff" textAnchor="start" fontWeight="bold" fontFamily="monospace">POC</text>
                </g>
            )}

            {/* LEVEL: TAKE PROFIT */}
            {geometry.tpY !== null && geometry.tpY >= 0 && geometry.tpY <= 100 && (
                <g>
                    <line x1="0" y1={geometry.tpY} x2="100" y2={geometry.tpY} stroke="#00ff9f" strokeWidth="0.5" strokeDasharray="3 3" opacity="0.6" vectorEffect="non-scaling-stroke" />
                    <text x="99" y={geometry.tpY - 2} fontSize="4" fill="#00ff9f" textAnchor="end" fontWeight="bold" fontFamily="monospace">TP</text>
                </g>
            )}

            {/* LEVEL: NEXT BUY */}
            {geometry.buyY !== null && geometry.buyY >= 0 && geometry.buyY <= 100 && (
                <g>
                    <line x1="0" y1={geometry.buyY} x2="100" y2={geometry.buyY} stroke="#fcee0a" strokeWidth="0.5" strokeDasharray="3 3" opacity="0.6" vectorEffect="non-scaling-stroke" />
                    <text x="99" y={geometry.buyY + 5} fontSize="4" fill="#fcee0a" textAnchor="end" fontWeight="bold" fontFamily="monospace">BUY</text>
                </g>
            )}

            {/* AREA FILL */}
            <path d={geometry.fillPath} fill="url(#sparkGrad)" className={`${color}`} style={{ mixBlendMode: 'screen' }} />
            
            {/* MAIN LINE */}
            <path d={geometry.linePath} fill="none" stroke="currentColor" strokeWidth="1.5" className={`${color}`} vectorEffect="non-scaling-stroke" />

            {/* EXECUTION MARKERS */}
            {geometry.markers.map((m, i) => (
                <g key={i} transform={`translate(${m.x}, ${m.y})`}>
                    {m.isBuy ? (
                        // BUY: Up Triangle
                        <path d="M0,-2 L-1.5,1.5 L1.5,1.5 Z" fill="#00f0ff" stroke="black" strokeWidth="0.2" />
                    ) : (
                        // SELL: Down Triangle (Color by PnL)
                        <path d="M0,2 L-1.5,-1.5 L1.5,-1.5 Z" fill={m.isWin ? '#00ff9f' : '#ff003c'} stroke="black" strokeWidth="0.2" />
                    )}
                </g>
            ))}

            {/* PULSING TIP */}
            <circle 
                cx={geometry.lastPoint.x} 
                cy={geometry.lastPoint.y} 
                r="1.5" 
                fill="white" 
                filter="url(#glowPoint)"
                className="animate-pulse"
            />
        </svg>
    );
};

export default React.memo(TacticalSparkline);
