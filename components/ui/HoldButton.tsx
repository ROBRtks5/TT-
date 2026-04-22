
import React, { useState, useRef, useEffect } from 'react';
import * as hapticService from '../../services/hapticService';

interface HoldButtonProps {
    label?: string; // Optional now
    isActive: boolean;
    onActivate: () => void;
    onDeactivate: () => void;
    className?: string;
    holdTimeMs?: number;
    variant?: 'standard' | 'mini'; // New variant
}

const HoldButton: React.FC<HoldButtonProps> = ({ 
    label, 
    isActive, 
    onActivate, 
    onDeactivate, 
    className = '',
    holdTimeMs = 800, // Faster reaction for UX
    variant = 'standard'
}) => {
    const [progress, setProgress] = useState(0);
    const [isHolding, setIsHolding] = useState(false);
    const intervalRef = useRef<any>(null);

    const startHold = () => {
        setIsHolding(true);
        hapticService.tap();
        setProgress(0);
        
        const startTime = Date.now();
        
        intervalRef.current = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const pct = Math.min(100, (elapsed / holdTimeMs) * 100);
            setProgress(pct);

            if (pct >= 100) {
                completeHold();
            }
        }, 16);
    };

    const completeHold = () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        hapticService.success();
        
        if (isActive) {
            onDeactivate();
        } else {
            onActivate();
        }
        
        setIsHolding(false);
        setProgress(0);
    };

    const stopHold = () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setIsHolding(false);
        setProgress(0);
    };

    // --- STANDARD BUTTON STYLES ---
    if (variant === 'standard') {
        const baseColor = isActive ? 'bg-cyber-yellow text-black' : 'bg-gray-800 text-gray-400';
        const borderColor = isActive ? 'border-cyber-yellow' : 'border-gray-600';
        
        return (
            <button
                className={`relative overflow-hidden rounded flex items-center justify-center font-black tracking-widest uppercase border-2 transition-all select-none touch-none ${baseColor} ${borderColor} ${className}`}
                onMouseDown={startHold}
                onMouseUp={stopHold}
                onMouseLeave={stopHold}
                onTouchStart={(e) => { e.preventDefault(); startHold(); }}
                onTouchEnd={stopHold}
                onContextMenu={(e) => e.preventDefault()}
            >
                <div 
                    className="absolute inset-0 bg-cyber-green opacity-50 z-0 transition-all ease-linear"
                    style={{ width: `${progress}%`, transitionDuration: isHolding ? '0ms' : '200ms' }}
                ></div>

                <span className="relative z-10 flex items-center gap-2 text-sm">
                    {isActive && <span className="animate-spin text-lg">⚙️</span>}
                    {label}
                </span>
            </button>
        );
    }

    // --- MINI (TACTICAL) SWITCH STYLES ---
    // Fixed: Now uses outlined style instead of solid block for better aesthetics
    const activeClass = 'border-cyber-green text-cyber-green shadow-[0_0_15px_rgba(0,255,159,0.3)] bg-green-900/20';
    const inactiveClass = 'border-gray-600 text-gray-500 bg-gray-900';
    const holdingClass = 'border-white text-white';

    return (
        <button
            className={`relative overflow-hidden rounded-md flex items-center justify-center border-2 transition-all select-none touch-none w-full h-full ${isHolding ? holdingClass : (isActive ? activeClass : inactiveClass)} ${className}`}
            onMouseDown={startHold}
            onMouseUp={stopHold}
            onMouseLeave={stopHold}
            onTouchStart={(e) => { e.preventDefault(); startHold(); }}
            onTouchEnd={stopHold}
            onContextMenu={(e) => e.preventDefault()}
        >
            {/* Fill Animation (Vertical) */}
            <div 
                className={`absolute bottom-0 left-0 right-0 ${isActive ? 'bg-cyber-green' : 'bg-white'} opacity-20 z-0 transition-all ease-linear`}
                style={{ height: `${progress}%`, transitionDuration: isHolding ? '0ms' : '200ms' }}
            ></div>

            {/* Power Icon */}
            <span className={`relative z-10 text-xl font-black leading-none ${isActive ? 'drop-shadow-[0_0_5px_rgba(0,255,159,0.8)]' : ''}`}>
                ⚡
            </span>
        </button>
    );
};

export default HoldButton;
