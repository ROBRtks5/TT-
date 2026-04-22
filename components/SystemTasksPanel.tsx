
/**
 * TITAN TRADING BOT - MISSION CONTROL UI
 * ---------------------------------------------------------
 * @module components/SystemTasksPanel.tsx
 * @version 1.2.1
 * @phase Phase 92: Prometheus Protocol (Live Timer)
 * @last-updated 2025-12-14
 * @description
 * Отображает статус фоновых задач.
 * UPD 1.2.1: Исправлена логика отображения таймера (показывается всегда, если есть nextRun).
 * ---------------------------------------------------------
 */
import React, { useState, useEffect } from 'react';
import { SystemTaskState, TaskStatus } from '../types';
import Card from './ui/Card';

// Helper to format time remaining
const formatTimeRemaining = (nextRun: number | null): string => {
    if (!nextRun) return '---';
    const remaining = nextRun - Date.now();
    if (remaining <= 0) return 'ГОТОВНОСТЬ';
    
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);

    if (hours > 0) return `~${hours}ч ${minutes}м`;
    if (minutes > 0) return `${minutes}м ${seconds}с`;
    return `${seconds}с`;
};

const TaskRow: React.FC<{ task: SystemTaskState, isAiOffline: boolean }> = ({ task, isAiOffline }) => {
    // Force re-render every second for live countdown
    const [, setTick] = useState(0);
    
    useEffect(() => {
        // Always tick to update timers
        const interval = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(interval);
    }, []);

    let statusText = '';
    let statusColor = 'text-gray-400';
    let isRunning = false;
    let isPaused = false;
    
    // Override for Smart Wait
    if (task.status === TaskStatus.PENDING && isAiOffline) {
        isPaused = true;
        statusText = '⏸️ ОЖИДАНИЕ AI';
        statusColor = 'text-yellow-500';
    } else {
        switch(task.status) {
            case TaskStatus.RUNNING:
                statusText = 'АКТИВЕН';
                statusColor = 'text-indigo-400 animate-pulse';
                isRunning = true;
                break;
            case TaskStatus.PENDING:
            case TaskStatus.IDLE: // Fix: IDLE with a timer is effectively PENDING
                if (task.nextRun && task.nextRun > Date.now()) {
                    statusText = `ЧЕРЕЗ: ${formatTimeRemaining(task.nextRun)}`;
                    statusColor = 'text-gray-500 font-mono';
                } else if (task.nextRun && task.nextRun <= Date.now()) {
                    statusText = 'НА ОЧЕРЕДИ';
                    statusColor = 'text-emerald-500 font-bold';
                } else {
                    statusText = 'ОЖИДАНИЕ...';
                    statusColor = 'text-gray-600';
                }
                break;
        }
    }

    const lastRunStr = task.lastRun ? `в ${new Date(task.lastRun).toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'})}` : 'никогда';
    
    return (
        <div className="flex items-center justify-between py-2 border-b border-gray-700/50 last:border-b-0">
            <div className="flex items-center gap-3">
                <div className={`relative flex h-3 w-3 ${isRunning ? 'animate-pulse' : ''}`}>
                    {isRunning && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>}
                    <span className={`relative inline-flex rounded-full h-3 w-3 ${isRunning ? 'bg-indigo-500' : isPaused ? 'bg-yellow-600' : (task.nextRun && task.nextRun <= Date.now() ? 'bg-emerald-500' : 'bg-gray-600')}`}></span>
                </div>
                <div className="flex flex-col">
                    <span className="text-sm font-semibold text-gray-200">{task.name}</span>
                    <span className="text-[10px] text-gray-500 font-mono">
                        Последний запуск: {lastRunStr}
                    </span>
                </div>
            </div>
            <div className={`text-xs font-bold font-mono ${statusColor} text-right min-w-[90px]`}>
                {statusText}
            </div>
        </div>
    );
};


const SystemTasksPanel: React.FC<{ tasks: SystemTaskState[] }> = ({ tasks }) => {
    // Check if AI is currently unavailable due to QUOTA (System paused)
    const isAiOffline = false;

    const sortedTasks = React.useMemo(() => {
        if (!tasks) return [];
        return [...tasks].sort((a, b) => {
            // Running first
            if (a.status === TaskStatus.RUNNING && b.status !== TaskStatus.RUNNING) return -1;
            if (b.status === TaskStatus.RUNNING && a.status !== TaskStatus.RUNNING) return 1;
            
            // Then those ready to run
            const aReady = a.nextRun && a.nextRun <= Date.now();
            const bReady = b.nextRun && b.nextRun <= Date.now();
            if (aReady && !bReady) return -1;
            if (bReady && !aReady) return 1;

            return 0;
        });
    }, [tasks]);

    return (
        <Card>
            <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                    </svg>
                    Центр Управления
                </h3>
                <span className="text-[10px] bg-gray-800 px-2 py-1 rounded text-gray-400 border border-gray-700">AUTONOMOUS</span>
            </div>
            <div className="space-y-1">
                {sortedTasks.map(task => <TaskRow key={task.id} task={task} isAiOffline={isAiOffline} />)}
            </div>
        </Card>
    );
};

export default SystemTasksPanel;
