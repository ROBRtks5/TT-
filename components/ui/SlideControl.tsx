
import React, { useState, useRef, useEffect } from 'react';
import * as hapticService from '../../services/hapticService';

interface SlideControlProps {
    onSuccess: () => void;
    label?: string;
    variant?: 'primary' | 'danger' | 'success'; // Added success
    disabled?: boolean;
    className?: string;
}

const SlideControl: React.FC<SlideControlProps> = ({
    onSuccess,
    label = 'СВАЙП ДЛЯ ПОДТВЕРЖДЕНИЯ',
    variant = 'primary',
    disabled = false,
    className = ''
}) => {
    const [dragWidth, setDragWidth] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [completed, setCompleted] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const lastTickRef = useRef(0);

    const getTheme = () => {
        if (variant === 'danger') {
            return {
                handle: 'bg-cyber-pink shadow-[0_0_15px_rgba(255,0,60,0.6)] text-black border border-white/20',
                track: 'border-cyber-pink/30 bg-red-950/40',
                text: 'text-cyber-pink',
                icon: '☢️',
                fill: 'bg-cyber-pink/20',
                glow: 'shadow-[inset_0_0_10px_rgba(255,0,60,0.2)]'
            };
        }
        if (variant === 'success') {
            return {
                handle: 'bg-cyber-green shadow-[0_0_15px_rgba(0,255,159,0.6)] text-black border border-white/20',
                track: 'border-cyber-green/30 bg-green-950/40',
                text: 'text-cyber-green',
                icon: '🚀',
                fill: 'bg-cyber-green/20',
                glow: 'shadow-[inset_0_0_10px_rgba(0,255,159,0.2)]'
            };
        }
        // Primary / Default
        return {
            handle: 'bg-cyber-yellow shadow-[0_0_15px_rgba(252,238,10,0.6)] text-black border border-white/20',
            track: 'border-cyber-yellow/30 bg-yellow-950/40',
            text: 'text-cyber-yellow',
            icon: '⚡',
            fill: 'bg-cyber-yellow/20',
            glow: 'shadow-[inset_0_0_10px_rgba(252,238,10,0.2)]'
        };
    };

    const theme = getTheme();

    const reset = () => {
        setIsDragging(false);
        setDragWidth(0);
        setCompleted(false);
        lastTickRef.current = 0;
    };

    const handleStart = (clientX: number) => {
        if (disabled || completed) return;
        setIsDragging(true);
        hapticService.tap();
    };

    const handleMove = (clientX: number) => {
        if (!isDragging || !containerRef.current || completed) return;

        const containerRect = containerRef.current.getBoundingClientRect();
        const handleWidth = 48; 
        const padding = 4;
        const maxDrag = containerRect.width - handleWidth - (padding * 2);
        
        let newPos = clientX - containerRect.left - (handleWidth / 2); 

        if (newPos < 0) newPos = 0;
        if (newPos > maxDrag) newPos = maxDrag;

        const percent = newPos / maxDrag;
        const tickStep = 0.2; 
        const currentTick = Math.floor(percent / tickStep);
        
        if (currentTick !== lastTickRef.current) {
            hapticService.selection();
            lastTickRef.current = currentTick;
        }

        setDragWidth(newPos);
    };

    const handleEnd = () => {
        if (!isDragging || !containerRef.current || completed) return;

        const containerRect = containerRef.current.getBoundingClientRect();
        const handleWidth = 48;
        const padding = 4;
        const maxDrag = containerRect.width - handleWidth - (padding * 2);
        
        const threshold = maxDrag * 0.8; // Relaxed threshold from 0.9

        if (dragWidth >= threshold) {
            setDragWidth(maxDrag);
            setCompleted(true);
            hapticService.success();
            onSuccess();
            setTimeout(reset, 2000);
        } else {
            setIsDragging(false);
            setDragWidth(0);
            hapticService.tap();
            lastTickRef.current = 0;
        }
    };

    const onMouseDown = (e: React.MouseEvent) => handleStart(e.clientX);
    const onMouseMove = (e: React.MouseEvent) => handleMove(e.clientX);
    const onMouseUp = () => handleEnd();
    const onMouseLeave = () => { if (isDragging) handleEnd(); };

    const onTouchStart = (e: React.TouchEvent) => handleStart(e.touches[0].clientX);
    const onTouchMove = (e: React.TouchEvent) => handleMove(e.touches[0].clientX);
    const onTouchEnd = () => handleEnd();

    useEffect(() => {
        const handleGlobalUp = () => { if (isDragging) handleEnd(); };
        window.addEventListener('mouseup', handleGlobalUp);
        return () => window.removeEventListener('mouseup', handleGlobalUp);
    }, [isDragging, dragWidth]);

    return (
        <div
            ref={containerRef}
            className={`relative h-14 w-full rounded-lg border overflow-hidden select-none touch-none transition-all ${theme.track} ${theme.glow} ${disabled ? 'opacity-50 grayscale cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'} ${className}`}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseLeave}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
        >
            {/* Background Pattern */}
            <div className="absolute inset-0 bg-[linear-gradient(45deg,transparent_25%,rgba(255,255,255,0.05)_50%,transparent_75%)] bg-[size:10px_10px] pointer-events-none opacity-50"></div>

            {/* Label */}
            <div className={`absolute inset-0 flex items-center justify-center text-[10px] font-black tracking-[0.3em] uppercase ${theme.text} opacity-80 z-0 pointer-events-none transition-opacity duration-300 ${isDragging ? 'opacity-100' : ''}`}>
                {completed ? 'ПРИНЯТО' : label} <span className="ml-2 animate-pulse">»»»</span>
            </div>

            {/* Progress Fill */}
            <div
                className={`absolute top-0 bottom-0 left-0 ${theme.fill} z-0 pointer-events-none transition-all duration-75 ${!isDragging ? 'duration-300' : ''}`}
                style={{ width: `${dragWidth + 48}px` }}
            >
                <div className="absolute right-0 top-0 bottom-0 w-px bg-white/20"></div>
            </div>

            {/* Handle */}
            <div
                className={`absolute top-1 bottom-1 left-1 w-12 rounded flex items-center justify-center font-bold text-xl z-10 shadow-lg ${theme.handle} ${!isDragging && !completed ? 'transition-all duration-300 ease-out' : 'transition-none'}`}
                style={{ transform: `translateX(${dragWidth}px)` }}
            >
                {completed ? '✓' : theme.icon}
            </div>
        </div>
    );
};

export default React.memo(SlideControl);
