import React, { useEffect, useRef, useState } from "react";
import { SystemConfig, InstrumentDetails } from "../types";
import * as hapticService from "../services/hapticService";

interface ControlDeckProps {
  hasPosition: boolean;
  dailyPnl: number;
  winRate: number;
  totalTrades: number;
  isBotActive: boolean;

  // MONOLITH PROPS
  instrumentTicker: string;
  onUpdateTicker: (ticker: string) => void;
  instrumentDetails: InstrumentDetails | null;
  instrumentName?: string;
  lastPrice?: number;
  buyingPower?: number;
}

const ControlDeck: React.FC<ControlDeckProps> = ({
  hasPosition = false,
  totalTrades = 0,
  isBotActive = false,
  instrumentTicker,
  onUpdateTicker,
  instrumentDetails,
  instrumentName,
  lastPrice = 0,
  buyingPower = 0,
}) => {
  // Local State for Ticker Input
  const [localTicker, setLocalTicker] = useState(instrumentTicker);
  const [isTyping, setIsTyping] = useState(false);
  const searchTimeout = useRef<any>(null);

  // Sync local ticker when prop changes (external update)
  useEffect(() => {
    if (!isTyping) {
      setLocalTicker(instrumentTicker);
    }
  }, [instrumentTicker, isTyping]);

  const handleTickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isBotActive) return; // Strict Lock for Ticker
    const val = e.target.value.toUpperCase();
    setLocalTicker(val);
    setIsTyping(true);

    if (searchTimeout.current) clearTimeout(searchTimeout.current);

    if (val.length >= 1) {
      searchTimeout.current = setTimeout(async () => {
        onUpdateTicker(val);
        setIsTyping(false);
        hapticService.selection();
      }, 1200);
    }
  };

  const handleTickerBlur = () => {
    setIsTyping(false);
    if (localTicker !== instrumentTicker) {
      onUpdateTicker(localTicker);
    }
  };

  // Validation Status
  const isTargetValid =
    !!instrumentDetails && instrumentDetails.ticker === instrumentTicker;
  const isSyncing =
    localTicker !== instrumentTicker ||
    (instrumentTicker && !instrumentDetails);

  let tickerStatusIcon = <span className="text-gray-600">?</span>;
  if (isTyping || isSyncing)
    tickerStatusIcon = (
      <svg
        className="animate-spin h-5 w-5 text-cyber-yellow"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        ></circle>
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        ></path>
      </svg>
    );
  else if (isTargetValid)
    tickerStatusIcon = <span className="text-cyber-green">✓</span>;
  else tickerStatusIcon = <span className="text-cyber-pink">✕</span>;

  // Funds Check (Low Funds Warning)
  const lotPrice = lastPrice * (instrumentDetails?.lot || 1);
  const isLowFunds = !hasPosition && buyingPower < lotPrice && lotPrice > 0;

  // Safety Lock for Start Button
  const isReadyToStart = isTargetValid && !isTyping && !isSyncing;

  // TACTICAL MODE LOGIC
  // If bot is active AND has position, replace settings with Panic Slider
  const showTacticalOps = isBotActive && hasPosition;

  return (
    <div className="w-full h-full bg-[#050505] border-t border-gray-800 flex flex-col px-4 pt-1 pb-2 relative z-40 shadow-[0_-10px_40px_rgba(0,0,0,0.8)]">
      {/* DECORATIVE TOP LINE */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/3 h-[1px] bg-gray-800 opacity-50"></div>

      {/* ROW 1: INFO STATS (Ultra Compact) */}
      <div className="flex justify-between items-center py-2 border-b border-gray-800/30 mb-2">
        <div className="flex items-center gap-3">
            <span className="text-[7px] text-gray-600 font-black uppercase tracking-wider">
              STATUS
            </span>
            <span className={`text-[10px] font-black font-mono tracking-widest ${isBotActive ? "text-cyber-cyan" : "text-gray-500"}`}>
               {isBotActive ? (hasPosition ? "IN POSITION ⚡" : "SCANNING 📡") : "SYSTEM IDLE"}
            </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[7px] text-gray-600 font-black uppercase tracking-wider">
            EXE
          </span>
          <span className="text-xs font-black font-mono text-white">
            #{totalTrades}
          </span>
        </div>
      </div>

      {/* ROW 2: TICKER VIEW (Compact) */}
      <div className="flex-1 flex flex-col justify-center min-h-0">
        <div className="bg-gray-900/20 border border-gray-700/50 rounded-sm p-1.5 flex flex-col relative">
          <span className="text-[9px] text-cyber-cyan/70 font-black uppercase tracking-[0.2em] mb-0.5 ml-1">
            {instrumentName || "TARGET"}
          </span>
          <div className="flex items-center">
            <input
              type="text"
              value={localTicker}
              onChange={handleTickerChange}
              onBlur={handleTickerBlur}
              disabled={isBotActive}
              className="bg-transparent text-white font-black font-mono text-xl outline-none uppercase w-full placeholder-gray-900 ml-1 tracking-[0.2em] disabled:cursor-not-allowed"
              placeholder="---"
            />
            <div className="absolute right-3 top-5 text-sm">
              {tickerStatusIcon}
            </div>
          </div>
          
          <div className="flex justify-between items-center mt-3 mx-1">
            <div className="flex flex-col">
              <span className="text-[8px] text-gray-600 uppercase tracking-widest font-bold mb-1 opacity-50">
                PROTOCOL
              </span>
              <div className="px-3 py-1.5 bg-cyber-cyan/10 border border-cyber-cyan/30 rounded-sm text-[9px] font-black text-cyber-cyan uppercase tracking-wider">
                T-TECH ADAPTIVE
              </div>
            </div>

            <div className="flex items-center gap-2 pr-1">
                <div className={`w-1.5 h-1.5 rounded-full ${isBotActive ? "bg-cyber-cyan animate-pulse shadow-[0_0_8px_rgba(0,255,255,0.5)]" : "bg-gray-800"}`}></div>
                <span className={`text-[8px] font-black tracking-widest ${isBotActive ? "text-cyber-cyan" : "text-gray-700"}`}>
                  {isBotActive ? "ACTIVE" : "STANDBY"}
                </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(ControlDeck);
