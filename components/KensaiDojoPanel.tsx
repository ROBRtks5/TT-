
/**
 * TITAN TRADING BOT - KENSAI DOJO (EVOLUTION REPORT)
 * ---------------------------------------------------------
 * @module components/KensaiDojoPanel.tsx
 * @version 17.1.0 (RUSSIAN)
 * @phase Protocol Darwin (DNA UI Update)
 * @last-updated 2025-12-15
 * ---------------------------------------------------------
 */
import React from 'react';
import Card from './ui/Card';

const ProfileCompare: React.FC<{ oldC: any, newC: any, name: string, icon: string, isActive: boolean }> = ({ oldC, newC, name, icon, isActive }) => {
    const renderStat = (label: string, oldVal: number, newVal: number) => {
        const diff = newVal - oldVal;
        let color = 'text-gray-400';
        if (diff > 0.1) color = 'text-green-400';
        if (diff < -0.1) color = 'text-red-400';
        const sign = diff > 0.01 ? '+' : '';

        return (
            <div className="flex justify-between items-center text-xs">
                <span className="text-gray-500">{label}</span>
                <div className="font-mono flex items-center gap-2">
                    <span className="text-gray-500 line-through">{oldVal.toFixed(0)}</span>
                    <span className="font-bold text-white">{newVal.toFixed(0)}</span>
                    <span className={`w-12 text-right ${color}`}>({sign}{diff.toFixed(0)})</span>
                </div>
            </div>
        );
    };

    return (
        <div className={`p-3 rounded-lg border transition-all ${isActive ? 'bg-indigo-900/30 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.2)]' : 'bg-gray-800/50 border-gray-700/50'}`}>
            <div className="flex justify-between items-center mb-2">
                <h4 className="text-sm font-bold flex items-center gap-2">{icon} {name}</h4>
                {isActive && <span className="text-[9px] bg-indigo-500 text-white px-1.5 py-0.5 rounded font-bold animate-pulse">АКТИВЕН</span>}
            </div>
            {renderStat('Buy >', oldC.buyThreshold, newC.buyThreshold)}
            {renderStat('Sell <', oldC.sellThreshold, newC.sellThreshold)}
        </div>
    );
};

const ScalperDnaBlock: React.FC<{ dna: any }> = ({ dna }) => {
    const formatPct = (val: number) => (val * 100).toFixed(2) + '%';
    
    return (
        <div className="bg-gradient-to-r from-purple-900/30 to-indigo-900/30 border border-purple-500/30 rounded-lg p-3 relative overflow-hidden">
            <div className="flex justify-between items-center mb-3 relative z-10">
                <h3 className="text-sm font-bold text-purple-200 flex items-center gap-2">
                    <span>🧬</span> ДНК СКАЛЬПЕРА (DYNAMIC)
                </h3>
                <span className="text-[9px] font-mono text-purple-400 bg-black/30 px-2 py-0.5 rounded">EVOLVED v2.1</span>
            </div>
            
            <div className="grid grid-cols-4 gap-2 relative z-10">
                <div className="bg-black/40 p-2 rounded text-center">
                    <div className="text-[9px] text-gray-500 uppercase font-bold">🎯 Цель</div>
                    <div className="text-emerald-400 font-mono font-bold text-lg">{formatPct(dna.takeProfitPrc)}</div>
                </div>
                <div className="bg-black/40 p-2 rounded text-center">
                    <div className="text-[9px] text-gray-500 uppercase font-bold">🛡️ Риск</div>
                    <div className="text-rose-400 font-mono font-bold text-lg">{formatPct(dna.stopLossPrc)}</div>
                </div>
                <div className="bg-black/40 p-2 rounded text-center">
                    <div className="text-[9px] text-gray-500 uppercase font-bold">🕸️ Coeff</div>
                    <div className="text-blue-300 font-mono font-bold text-lg">{dna.spacingCoeff?.toFixed(2)}x</div>
                    <div className="text-[8px] text-gray-600">ATR MULT</div>
                </div>
                <div className="bg-black/40 p-2 rounded text-center">
                    <div className="text-[9px] text-gray-500 uppercase font-bold">⚖️ Перекос</div>
                    <div className="text-yellow-300 font-mono font-bold text-lg">{dna.skew.toFixed(2)}</div>
                </div>
            </div>
            
            {/* Background DNA Helix Effect */}
            <div className="absolute -right-4 -bottom-4 text-8xl opacity-5 pointer-events-none select-none text-purple-500 animate-pulse">
                🧬
            </div>
        </div>
    );
};


const KensaiDojoPanel: React.FC<{ 
    report: any | null, 
    activeProfileId?: any,
    scalperDna?: any // NEW PROP
}> = ({ report, activeProfileId, scalperDna }) => {
    
    // If we have Scalper DNA, show it prominently as it overrides old logic
    if (scalperDna) {
        return (
            <Card className="w-full mb-4">
                <ScalperDnaBlock dna={scalperDna} />
            </Card>
        );
    }
    
    if (!report) {
        return (
            <Card className="w-full mb-4">
                <div className="flex flex-col items-center justify-center h-24 text-gray-600 opacity-50">
                    <span className="text-2xl mb-2">🧬</span>
                    <span className="text-xs font-mono uppercase tracking-widest">Ожидание Эволюции...</span>
                </div>
            </Card>
        );
    }
    
    const isIntervention = report.reasoning.includes('🚨');
    const isUpgrade = !report.protocolZeroTriggered && !isIntervention;
    
    const scoreDiff = report.newValidationScore - report.oldValidationScore;
    const scoreColor = scoreDiff > 0 ? 'text-green-400' : (scoreDiff < 0 ? 'text-red-400' : 'text-gray-400');
    const scoreSign = scoreDiff > 0 ? '+' : '';

    return (
        <Card className="w-full mb-4">
            <div className="flex justify-between items-start mb-4">
                <h2 className="text-xl font-bold text-gray-200 flex items-center gap-2">
                    <span>🥋</span> Додзе Кэнсая (Legacy)
                </h2>
                <span className="text-xs text-gray-500 font-mono">{new Date(report.timestamp).toLocaleString('ru-RU')}</span>
            </div>

            <div className="space-y-4">
                {/* AI Verdict */}
                <div className={`border p-3 rounded-lg ${isIntervention ? 'bg-red-900/40 border-red-500/50' : 'bg-indigo-900/20 border-indigo-500/30'}`}>
                    <div className={`text-[10px] font-bold uppercase mb-1 flex items-center gap-1 ${isIntervention ? 'text-red-300' : 'text-indigo-300'}`}>
                        <span>{isIntervention ? '🚨' : '🧐'}</span> {isIntervention ? "ВМЕШАТЕЛЬСТВО 'ПРИЗРАКА'" : "Великая Гипотеза"}
                    </div>
                    <p className={`text-xs italic leading-relaxed ${isIntervention ? 'text-red-100' : 'text-indigo-100'}`}>
                        "{report.reasoning.replace('🚨 ВМЕШАТЕЛЬСТВО \'ПРИЗРАКА\': ', '')}"
                    </p>
                </div>

                {/* Main Results */}
                <div className={`p-4 rounded-lg border flex flex-col md:flex-row justify-between items-center ${isUpgrade ? 'bg-green-900/10 border-green-700/50' : 'bg-red-900/10 border-red-700/50'}`}>
                    <div className="text-center md:text-left">
                        <div className="text-sm font-bold uppercase tracking-wider text-gray-300">Вердикт</div>
                        <div className={`text-2xl font-black ${isUpgrade ? 'text-green-400' : 'text-red-400'}`}>
                            {isUpgrade ? 'АРСЕНАЛ ОБНОВЛЕН' : (isIntervention ? 'ПРИНУДИТЕЛЬНЫЙ ОТКАТ' : 'ОТКАТ')}
                        </div>
                    </div>
                    {!isIntervention && (
                        <div className="text-center mt-4 md:mt-0 md:text-right">
                             <div className="text-sm font-bold uppercase tracking-wider text-gray-400">PnL (Валидация)</div>
                            <div className={`text-2xl font-black font-mono ${scoreColor}`}>
                                {scoreSign}{scoreDiff.toFixed(2)} ₽
                            </div>
                            <div className="text-xs text-gray-500 font-mono">
                                ({report.oldValidationScore.toFixed(2)} ₽ {'->'} {report.newValidationScore.toFixed(2)} ₽)
                            </div>
                        </div>
                    )}
                </div>

                {/* Profiles Comparison */}
                {!isIntervention && (
                    <div>
                        <h3 className="text-sm font-semibold text-gray-400 mb-2">Сравнение Профилей</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <ProfileCompare oldC={report.oldArsenal.bullProfile} newC={report.newArsenal.bullProfile} name="Бык" icon="🐂" isActive={activeProfileId === 'BULL'} />
                            <ProfileCompare oldC={report.oldArsenal.bearProfile} newC={report.newArsenal.bearProfile} name="Медведь" icon="🐻" isActive={activeProfileId === 'BEAR'} />
                            <ProfileCompare oldC={report.oldArsenal.chopProfile} newC={report.newArsenal.chopProfile} name="Флэт" icon="⚓" isActive={activeProfileId === 'CHOP'} />
                        </div>
                    </div>
                )}
            </div>
        </Card>
    );
};

export default KensaiDojoPanel;
