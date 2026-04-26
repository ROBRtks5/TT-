import React, { useState, useEffect } from "react";
import { BotStatus, ConnectionStatus, SystemConfig } from "../types";
import SensorLED, { SensorStatus } from "./ui/SensorLED";
import HoldButton from "./ui/HoldButton";
import Button from "./ui/Button";
import { getMoscowParts, getDetailedSessionStatus } from "../utils/marketTime";
import * as hapticService from "../services/hapticService";
import * as debugService from "../services/debugService";

interface StatusDeckProps {
  status: BotStatus;
  connectionStatus: ConnectionStatus;
  isBotActive: boolean;
  onToggleActive: () => void;
  onOpenBios: () => void; // Opens API Key Modal
  onOpenScreensaver?: () => void;
  botState?: any;
}

const StatusDeck: React.FC<StatusDeckProps> = ({
  status = BotStatus.STOPPED,
  connectionStatus = ConnectionStatus.DISCONNECTED,
  isBotActive = false,
  onToggleActive,
  onOpenBios,
  onOpenScreensaver,
  botState,
}) => {
  const [clock, setClock] = useState("");
  const [sessionTimer, setSessionTimer] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);

  useEffect(() => {
    const updateTime = () => {
      try {
        const { hours, minutes } = getMoscowParts();
        setClock(
          `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
        );

        const details = getDetailedSessionStatus();
        setSessionTimer(`${details.sub}`);
      } catch (e) {
        console.warn("Clock Tick Error:", e);
        setClock("--:--");
      }
    };

    const interval = setInterval(updateTime, 1000);
    updateTime();
    return () => clearInterval(interval);
  }, []);

  // Sensor Logic
  const netStatus: SensorStatus =
    connectionStatus === "CONNECTED"
      ? "OK"
      : connectionStatus === "CONNECTING" || connectionStatus === "RECONNECTING"
        ? "WARNING"
        : "ERROR";

  let kernelStatus: SensorStatus = "OFF";
  if (isBotActive) {
    switch (status) {
      case BotStatus.TRADING:
      case BotStatus.WAITING:
      case BotStatus.ENTERING_GRID:
        kernelStatus = "OK";
        break;
      case BotStatus.ANALYZING:
      case BotStatus.STARTING:
        kernelStatus = "BUSY";
        break;
      case BotStatus.STALE_DATA:
        kernelStatus = "STALE";
        break;
      case BotStatus.MARKET_CLOSED:
        kernelStatus = "OFF";
        break;
      default:
        kernelStatus = "ERROR";
    }
  }

  const coreLabel = status === BotStatus.MARKET_CLOSED ? "СОН" : "ДВИЖОК";

  const handleClockClick = () => {
    hapticService.tap();
    setShowSchedule(!showSchedule);
    if (!showSchedule) setTimeout(() => setShowSchedule(false), 5000);
  };

  // --- BLACK BOX DUMP HANDLER ---
  const handleDebugDump = () => {
    hapticService.success();

    // Gather extensive context for the AI Architect
    const context = {
      bot: {
        status: status,
        isActive: isBotActive,
        connection: connectionStatus,
        ticker: botState?.instrumentTicker,
      },
      config: botState?.systemConfig,
      positions: botState?.position || null,
      orders: botState?.activeGridOrders || [],
      ammCapital: botState?.ammCapitalState || null,
      funds: {
        effectiveBuyingPower: botState?.effectiveBuyingPower || 0,
      },
      margin: botState?.marginAttributes || null,
      history: {
        tradesCount: botState?.tradeHistory?.length || 0,
        lastPnlResult:
          botState?.tradeHistory?.[botState?.tradeHistory?.length - 1]?.pnl,
        recentTrades: botState?.tradeHistory?.slice(-5) || [],
      },
      marketData: {
        lastTrades: botState?.lastTrades?.slice(0, 5) || [],
        lastCandles:
          typeof botState?.chartData?.["1m"] !== "undefined"
            ? botState.chartData["1m"].slice(-3)
            : [],
        orderBookSpread: botState?.orderBook?.spreadPercent || null,
      },
      appHealth: botState?.health || null,
      telemetry: botState?.telemetry || null,
      recentLogs: botState?.logs?.slice(-20) || [],
    };

    const report = debugService.getSystemSnapshot(context);

    navigator.clipboard
      .writeText(report)
      .then(() => {
        alert("📋 ДИАГНОСТИКА СКОПИРОВАНА!\n(Включая настройки и логи)");
      })
      .catch((err) => {
        alert("Ошибка копирования: " + err);
      });
  };

  const sessionInfo = getDetailedSessionStatus();

  return (
    <div className="w-full h-full flex items-center justify-between px-3 bg-black border-b border-gray-800 z-50 relative shadow-md">
      {/* LEFT: SENSORS (Compact) */}
      <div className="flex flex-col gap-1.5 min-w-[70px]">
        <SensorLED label="СЕТЬ" status={netStatus} />
        <SensorLED
          label={coreLabel}
          status={kernelStatus}
          showGlow={status !== BotStatus.MARKET_CLOSED}
        />
      </div>

      {/* CENTER: CHRONOS */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center cursor-pointer select-none group"
        onClick={handleClockClick}
      >
        <div className="text-4xl font-black text-gray-200 tracking-tighter font-mono leading-none drop-shadow-[0_0_15px_rgba(255,255,255,0.1)] group-active:scale-95 transition-transform">
          {clock}
        </div>
        <div
          className={`text-[9px] font-bold tracking-[0.2em] uppercase mt-1 ${sessionInfo.code === "OPEN" ? "text-cyber-green" : "text-gray-600"}`}
        >
          {sessionTimer}
        </div>

        {showSchedule && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 w-48 bg-black/95 border border-gray-700 rounded p-3 shadow-2xl backdrop-blur-md z-[100] animate-fade-in-up">
            <div className="text-[10px] text-gray-500 uppercase font-bold border-b border-gray-800 pb-1 mb-2">
              Статус Биржи (MSK)
            </div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-gray-400 text-xs">Режим:</span>
              <span
                className={`text-xs font-bold ${sessionInfo.code === "OPEN" ? "text-green-400" : "text-orange-400"}`}
              >
                {sessionInfo.text}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* RIGHT: COMMANDS (4 Distinct Buttons) */}
      <div className="flex items-center gap-2">
        {/* 1. SCREENSAVER */}
        <Button
          onClick={() => onOpenScreensaver && onOpenScreensaver()}
          variant="secondary"
          className="w-9 h-9 p-0 flex items-center justify-center border-gray-800 text-gray-500 hover:text-cyber-green hover:border-cyber-green transition-all rounded-md bg-gray-900/50"
          title="АВТОНОМНЫЙ РЕЖИМ (Скринсейвер)"
        >
          <span className="text-sm">⚡</span>
        </Button>

        {/* 2. DEBUG (Black Box) */}
        <Button
          onClick={handleDebugDump}
          variant="secondary"
          className="w-9 h-9 p-0 flex items-center justify-center border-gray-800 text-gray-500 hover:text-cyber-yellow hover:border-cyber-yellow transition-all rounded-md bg-gray-900/50"
          title="СКОПИРОВАТЬ ОТЧЕТ"
        >
          <span className="text-sm">🐞</span>
        </Button>

        {/* 2. API KEY (Key Management) */}
        <Button
          onClick={onOpenBios}
          variant="secondary"
          className="w-9 h-9 p-0 flex items-center justify-center border-gray-800 text-gray-500 hover:text-cyber-cyan hover:border-cyber-cyan transition-all rounded-md bg-gray-900/50"
          title="API КЛЮЧИ"
        >
          <span className="text-sm">🔑</span>
        </Button>

        {/* 3. POWER (Start/Stop) */}
        <div className="w-14 h-9">
          <HoldButton
            isActive={isBotActive}
            onActivate={onToggleActive}
            onDeactivate={onToggleActive}
            variant="mini"
            className="w-full h-full shadow-lg"
          />
        </div>
      </div>
    </div>
  );
};

export default React.memo(StatusDeck);
