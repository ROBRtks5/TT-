
import React, { useMemo } from 'react';

interface BrainMapProps {
    rsi: number;          // 0-100
    trendScore: number;   // 0-100 (50 is neutral)
    volatility: number;   // 0-100 (Relative ATR %)
    conviction: number;   // 0-100 (Confidence)
    risk: number;         // 0-100 (Oracle Risk)
    className?: string;
}

const BrainMap: React.FC<BrainMapProps> = ({ 
    rsi = 50, 
    trendScore = 50, 
    volatility = 20, 
    conviction = 0, 
    risk = 0,
    className = ''
}) => {
    // Canvas dimensions
    const SIZE = 200;
    const CENTER = SIZE / 2;
    const RADIUS = 80;

    // Normalize Data Points (0.0 to 1.0)
    const data = useMemo(() => {
        // RSI: 50 is center (0), <30 is ext (1.0), >70 is ext (1.0)
        // We actually want raw normalized value 0-1
        const nRsi = Math.max(0, Math.min(100, rsi)) / 100;
        const nTrend = Math.max(0, Math.min(100, trendScore)) / 100;
        const nVol = Math.max(0, Math.min(100, volatility)) / 100;
        const nConv = Math.max(0, Math.min(100, conviction)) / 100;
        const nRisk = Math.max(0, Math.min(100, risk)) / 100;
        
        return { nRsi, nTrend, nVol, nConv, nRisk };
    }, [rsi, trendScore, volatility, conviction, risk]);

    // 5 Axes: RSI, TREND, VOL, CONV, RISK
    // Angles: -90 (Top), -18, 54, 126, 198
    const axes = [
        { label: 'RSI', angle: -90, value: data.nRsi, color: '#fcee0a' },
        { label: 'TREND', angle: -18, value: data.nTrend, color: '#00ff9f' },
        { label: 'VOL', angle: 54, value: data.nVol, color: '#bd00ff' },
        { label: 'RISK', angle: 126, value: data.nRisk, color: '#ff003c' },
        { label: 'CONV', angle: 198, value: data.nConv, color: '#00f0ff' },
    ];

    // Helper to get coordinates
    const getCoord = (angleDeg: number, val: number) => {
        const angleRad = (angleDeg * Math.PI) / 180;
        return {
            x: CENTER + Math.cos(angleRad) * (RADIUS * val),
            y: CENTER + Math.sin(angleRad) * (RADIUS * val)
        };
    };

    // Generate Polygon Path
    const pathD = axes.map((ax, i) => {
        const { x, y } = getCoord(ax.angle, ax.value);
        return `${i === 0 ? 'M' : 'L'} ${x},${y}`;
    }).join(' ') + ' Z';

    // Generate Background Grid (3 levels)
    const gridLevels = [0.25, 0.5, 0.75, 1.0];

    return (
        <div className={`relative flex items-center justify-center ${className}`}>
            <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="overflow-visible">
                <defs>
                    <radialGradient id="radarGlow" cx="0.5" cy="0.5" r="0.5">
                        <stop offset="0%" stopColor="rgba(0, 240, 255, 0.2)" />
                        <stop offset="100%" stopColor="transparent" />
                    </radialGradient>
                    <filter id="neonBlur">
                        <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                        <feMerge>
                            <feMergeNode in="coloredBlur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>

                {/* BACKGROUND WEBS */}
                {gridLevels.map((level, i) => (
                    <polygon
                        key={i}
                        points={axes.map(ax => {
                            const { x, y } = getCoord(ax.angle, level);
                            return `${x},${y}`;
                        }).join(' ')}
                        fill="none"
                        stroke={i === 3 ? '#333' : '#222'}
                        strokeWidth="1"
                        strokeDasharray={i === 3 ? 'none' : '2,2'}
                    />
                ))}

                {/* AXES LINES */}
                {axes.map((ax, i) => {
                    const end = getCoord(ax.angle, 1.0);
                    return (
                        <g key={i}>
                            <line x1={CENTER} y1={CENTER} x2={end.x} y2={end.y} stroke="#333" strokeWidth="1" />
                            {/* LABELS */}
                            <text 
                                x={end.x + (end.x - CENTER) * 0.2} 
                                y={end.y + (end.y - CENTER) * 0.2} 
                                fill={ax.color} 
                                fontSize="9" 
                                fontFamily="monospace"
                                fontWeight="bold"
                                textAnchor="middle" 
                                dominantBaseline="middle"
                            >
                                {ax.label}
                            </text>
                        </g>
                    );
                })}

                {/* DATA POLYGON */}
                <path 
                    d={pathD} 
                    fill="rgba(0, 240, 255, 0.15)" 
                    stroke="#00f0ff" 
                    strokeWidth="2" 
                    filter="url(#neonBlur)"
                    className="transition-all duration-500 ease-out"
                />

                {/* DATA POINTS */}
                {axes.map((ax, i) => {
                    const { x, y } = getCoord(ax.angle, ax.value);
                    return (
                        <circle 
                            key={i} 
                            cx={x} 
                            cy={y} 
                            r="3" 
                            fill={ax.color} 
                            className="transition-all duration-500 ease-out"
                        />
                    );
                })}

                {/* CENTER GLOW */}
                <circle cx={CENTER} cy={CENTER} r="10" fill="#fff" opacity="0.1" className="animate-pulse" />

            </svg>
        </div>
    );
};

export default React.memo(BrainMap);
