
import React, { useState, useCallback, useMemo } from 'react';
import { useTradingBot } from '../hooks/useTradingBot';
import { useUI } from '../context/UIContext';
import { SystemConfig } from '../types';

// MODALS
import ApiKeyModal from './ui/ApiKeyModal';
// BIOS MODAL REMOVED (Protocol Monolith)
import ConfirmationDialog from './ui/ConfirmationDialog';

// SAFETY
import WidgetBoundary from './WidgetBoundary';

// ZONES
import StatusDeck from './StatusDeck';
import ReactorCore from './ReactorCore';
import IntelligenceTerminal from './IntelligenceTerminal';
import ControlDeck from './ControlDeck';

const DEFAULT_CONFIG: SystemConfig = {
    risk: { maxDailyLossPercent: 0.02, maxLeverage: 7, maxDrawdownAction: 'STOP' },
    time: { sessionStartHour: 10, sessionEndHour: 23, forceCloseHour: 23, forceCloseMinute: 45 }
};

const Dashboard: React.FC = () => {
    const bot = useTradingBot();
    const ui = useUI();

    const [isStopConfirmOpen, setStopConfirmOpen] = useState(false);
    const [isResetConfirmOpen, setResetConfirmOpen] = useState(false);

    const latestPrice = useMemo(() => {
        if (bot.lastTrades && bot.lastTrades.length > 0) return bot.lastTrades[0].price;
        if (bot.chartData && bot.chartData['1m'] && bot.chartData['1m'].length > 0) {
            return bot.chartData['1m'][bot.chartData['1m'].length - 1].price;
        }
        return 0;
    }, [bot.lastTrades, bot.chartData]);

    const reactorChartData = useMemo(() => {
        return (bot.chartData && bot.chartData['1m']) ? bot.chartData['1m'] : [];
    }, [bot.chartData]);

    const hasPosition = useMemo(() => {
        return !!bot.position && Math.abs(bot.position.currentQuantity) > 0;
    }, [bot.position]);

    const sessionStats = useMemo(() => {
        const history = bot.tradeHistory || [];
        // Only count 'TRADE' operations for winrate
        const tradeOps = history.filter(t => t.type === 'TRADE');
        const closedTrades = tradeOps.filter(t => t.outcome !== 'Neutral'); 
        
        let dailyPnl = 0;
        let wins = 0;
        
        tradeOps.forEach(t => {
            dailyPnl += (t.pnl || 0);
            if (t.outcome === 'Success') wins++;
        });

        const totalExecutions = tradeOps.length;
        const totalClosed = closedTrades.length;
        const winRate = totalClosed > 0 ? (wins / totalClosed) * 100 : 0;
        
        return { dailyPnl: dailyPnl, winRate, totalTrades: totalExecutions };
    }, [bot.tradeHistory]);

    const handleSaveApiKey = useCallback(async (apiKey: string, geminiKey?: string) => {
        ui.handleSaveApiKey(apiKey, geminiKey);
        bot.postCommand({ type: 'SAVE_API_KEY', payload: { apiKey } });
    }, [ui, bot]);

    const handleConfirmStop = () => {
        bot.toggleBotActive();
        setStopConfirmOpen(false);
    };

    const handleConfirmReset = () => {
        bot.handleResetMemory();
        setResetConfirmOpen(false);
    };

    const handleRunSimulation = useCallback(() => {
        bot.postCommand({ type: 'RUN_OFFLINE_SIMULATION' });
    }, [bot]);

    return (
        <div className="titan-grid bg-black text-gray-200 font-mono relative select-none overflow-hidden h-[100dvh] flex flex-col">
            
            {/* BACKGROUND MATRIX */}
            <div className="absolute inset-0 bg-[linear-gradient(rgba(18,18,18,0.5)_1px,transparent_1px),linear-gradient(90deg,rgba(18,18,18,0.5)_1px,transparent_1px)] bg-[size:20px_20px] pointer-events-none z-0 opacity-20"></div>

            {/* MODALS */}
            <ApiKeyModal 
                isOpen={ui.isApiKeyModalOpen || (ui.isKeyRequired && !bot.isBotActive)} 
                onClose={() => ui.setIsApiKeyModalOpen(false)} 
                onSave={handleSaveApiKey} 
            />
            
            <ConfirmationDialog 
                isOpen={isStopConfirmOpen} 
                onClose={() => setStopConfirmOpen(false)} 
                onConfirm={handleConfirmStop} 
                title="Остановка Торговли"
            >
                Внимание: Позиция останется открытой. Робот перестанет управлять ордерами.
            </ConfirmationDialog>
            <ConfirmationDialog 
                isOpen={isResetConfirmOpen} 
                onClose={() => setResetConfirmOpen(false)} 
                onConfirm={handleConfirmReset} 
                title="Сброс Памяти"
            >
                Это действие необратимо. Вся история обучения будет удалена.
            </ConfirmationDialog>

            {/* ZONE 1: HEADER */}
            <header className="relative z-30 border-b border-gray-900 bg-black shrink-0">
                <WidgetBoundary label="STATUS_DECK" className="h-12">
                    <StatusDeck 
                        status={bot.status}
                        connectionStatus={bot.connectionStatus}
                        isBotActive={bot.isBotActive}
                        onToggleActive={bot.toggleBotActive}
                        onOpenBios={() => ui.setIsApiKeyModalOpen(true)}
                        botState={bot}
                    />
                </WidgetBoundary>
            </header>

            {/* ZONE 2: REACTOR */}
            <main className="flex-1 flex flex-col min-h-0 relative z-10">
                {/* SPLIT VIEW */}
                <div className="flex-1 flex min-h-0">
                    <WidgetBoundary label="REACTOR_CORE" className="flex-[2] border-r border-gray-900 relative">
                        <ReactorCore 
                            position={bot.position}
                            lastPrice={latestPrice}
                            chartData={reactorChartData}
                            serverStopLoss={bot.serverStopLossLevel}
                            ammCapitalState={bot.ammCapitalState}
                            analysis={bot.currentAnalysis}
                            status={bot.status} 
                            tradeHistory={bot.tradeHistory} 
                        />
                    </WidgetBoundary>
                    
                    <WidgetBoundary label="INTELLIGENCE" className="flex-1 min-w-[300px] bg-black hidden lg:block border-l border-gray-800">
                        <IntelligenceTerminal 
                            logs={bot.logs} 
                            telemetry={bot.telemetry}
                            analysis={bot.currentAnalysis}
                            tradeHistory={bot.tradeHistory}
                        />
                    </WidgetBoundary>
                </div>

                {/* ZONE 4: CONTROL DECK (Footer) */}
                <div className="h-[200px] shrink-0 relative z-20 overflow-visible">
                    <ControlDeck 
                        hasPosition={hasPosition}
                        totalTrades={sessionStats.totalTrades}
                        dailyPnl={sessionStats.dailyPnl}
                        winRate={sessionStats.winRate}
                        isBotActive={bot.isBotActive}
                        // MONOLITH PROPS
                        instrumentTicker={bot.instrumentTicker}
                        onUpdateTicker={bot.setInstrumentTicker}
                        instrumentDetails={bot.instrumentDetails} 
                        instrumentName={bot.instrumentDetails?.name} 
                        // FUNDS CHECK
                        lastPrice={latestPrice}
                        buyingPower={bot.effectiveBuyingPower}
                    />
                </div>
            </main>
        </div>
    );
};

export default Dashboard;
