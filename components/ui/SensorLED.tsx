
import React from 'react';

export type SensorStatus = 'OK' | 'WARNING' | 'ERROR' | 'BUSY' | 'OFF' | 'STALE';

interface SensorLEDProps {
    label: string;
    status: SensorStatus;
    value?: string | number;
    className?: string;
    showGlow?: boolean;
}

const SensorLED: React.FC<SensorLEDProps> = ({ 
    label, 
    status, 
    className = '',
    showGlow = true
}) => {
    
    // Updated Colors: Stronger Glows, brighter cores
    const getStyle = (s: SensorStatus) => {
        switch (s) {
            case 'OK': return 'bg-[#00ff9f] shadow-[0_0_8px_2px_rgba(0,255,159,0.5)]';
            case 'WARNING': return 'bg-[#fcee0a] shadow-[0_0_8px_2px_rgba(252,238,10,0.5)]';
            case 'ERROR': return 'bg-[#ff003c] shadow-[0_0_10px_3px_rgba(255,0,60,0.6)] animate-pulse';
            case 'BUSY': return 'bg-[#00f0ff] shadow-[0_0_8px_2px_rgba(0,240,255,0.5)] animate-pulse';
            case 'STALE': return 'bg-orange-500 shadow-[0_0_8px_2px_rgba(249,115,22,0.5)]'; // NEW: Orange for Stale
            case 'OFF': return 'bg-gray-800 border border-gray-700'; // No glow, just frame
            default: return 'bg-gray-800';
        }
    };

    const styleClass = getStyle(status);

    return (
        <div className={`flex items-center gap-3 select-none ${className}`}>
            {/* The Diode (Circle now, larger) */}
            <div className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${styleClass}`}></div>
            
            {/* Label */}
            <span className={`text-[10px] font-bold font-mono uppercase tracking-wider leading-none ${status === 'OFF' ? 'text-gray-700' : 'text-gray-400'}`}>
                {label}
            </span>
        </div>
    );
};

export default React.memo(SensorLED);
