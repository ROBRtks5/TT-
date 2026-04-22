import React, { useEffect, useState } from 'react';

// TITAN-IRONCLAD RESTORATION
// This component previously used hardware-accelerated canvas `drawImage` over itself, 
// which absolutely decimated mobile GPUs over 10 minutes resulting in full application crashes.
// Replaced with a lightweight CSS pulsing implementation.

interface HeartbeatStripProps {
    lastTick: number;
    status?: 'OK' | 'WARNING' | 'ERROR' | 'OFF';
    className?: string;
    height?: number;
}

const HeartbeatStrip: React.FC<HeartbeatStripProps> = ({ 
    lastTick, 
    status = 'OK', 
    className = '',
    height = 32 
}) => {
    const [pulse, setPulse] = useState(false);

    useEffect(() => {
        setPulse(true);
        const t = setTimeout(() => setPulse(false), 200);
        return () => clearTimeout(t);
    }, [lastTick]);

    const getColor = () => {
        switch(status) {
            case 'OK': return 'cyber-cyan';
            case 'WARNING': return 'cyber-purple';
            case 'ERROR': return 'cyber-pink';
            default: return 'gray-500';
        }
    };

    const color = getColor();

    return (
        <div style={{ height }} className={`w-full bg-[#050505] overflow-hidden relative flex items-center ${className}`}>
            <div className={`w-full h-[1px] bg-${color}/30 relative`}>
                <div 
                    className={`absolute right-0 top-1/2 -translate-y-1/2 w-[4px] h-[4px] bg-${color} rounded-full transition-all duration-100 shadow-[0_0_8px_theme(colors.${color})] ${pulse ? 'scale-150 opacity-100' : 'scale-100 opacity-50'}`}
                />
            </div>
            {/* Retro Grid Overlay */}
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:10px_10px] pointer-events-none"></div>
        </div>
    );
};

export default React.memo(HeartbeatStrip);
