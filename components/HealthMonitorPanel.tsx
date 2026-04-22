/**
 * TITAN TRADING BOT - HEALTH MONITOR (COMPACT)
 * ---------------------------------------------------------
 * @module components/HealthMonitorPanel.tsx
 * @version 3.0.0
 * @phase Phase: Optimization
 * @description
 * Компактный монитор состояния ядра. 
 * Убрана лишняя графика, оставлены только критические метрики для Web Worker.
 * ---------------------------------------------------------
 */

import React, { useMemo } from 'react';
import Card from './ui/Card';
import { HealthState } from '../types';
import { PROJECT_VERSION } from '../constants';

interface HealthMonitorPanelProps {
  health: HealthState;
}

const HealthMonitorPanel: React.FC<HealthMonitorPanelProps> = ({ health }) => {
  
  const latency = health.lastCycleDurationMs || 0;
  const isLagging = latency > 2000;
  const isCritical = latency > 5000;

  const latencyColor = isCritical ? 'text-red-500' : isLagging ? 'text-yellow-500' : 'text-emerald-500';
  
  return (
    <Card title="Системное Ядро">
      <div className="grid grid-cols-2 gap-3 text-xs font-mono">
        
        {/* WORKER STATUS */}
        <div className="bg-gray-900/50 p-2 rounded border border-gray-700/50 flex flex-col justify-between">
            <span className="text-gray-500 uppercase text-[9px]">Статус</span>
            <div className="flex items-center gap-2 mt-1">
                <span className={`w-2 h-2 rounded-full ${health.status === 'OK' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}></span>
                <span className={`font-bold ${health.status === 'OK' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {health.status === 'OK' ? 'АКТИВЕН' : 'СБОЙ'}
                </span>
            </div>
        </div>

        {/* LATENCY */}
        <div className="bg-gray-900/50 p-2 rounded border border-gray-700/50 flex flex-col justify-between">
            <span className="text-gray-500 uppercase text-[9px]">Задержка</span>
            <div className={`font-bold mt-1 ${latencyColor}`}>
                {latency} ms
            </div>
        </div>

        {/* ERRORS */}
        <div className="bg-gray-900/50 p-2 rounded border border-gray-700/50 flex flex-col justify-between">
            <span className="text-gray-500 uppercase text-[9px]">Ошибки</span>
            <div className={`${health.consecutiveErrors > 0 ? 'text-red-400' : 'text-gray-300'} font-bold mt-1`}>
                {health.consecutiveErrors} подряд
            </div>
        </div>

        {/* HEARTBEAT */}
        <div className="bg-gray-900/50 p-2 rounded border border-gray-700/50 flex flex-col justify-between">
            <span className="text-gray-500 uppercase text-[9px]">Пульс</span>
            <div className="text-indigo-300 font-bold mt-1 truncate">
                {new Date(health.lastCheck).toLocaleTimeString()}
            </div>
        </div>

      </div>
      
      <div className="mt-3 text-[9px] text-center text-gray-600 border-t border-gray-800 pt-2">
          v{PROJECT_VERSION} • Среда Worker
      </div>
    </Card>
  );
};

export default React.memo(HealthMonitorPanel);