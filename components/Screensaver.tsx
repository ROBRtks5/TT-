import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ConnectionStatus } from "../types";
import { PROJECT_VERSION } from "../constants";
import { KeepAwake } from "@capacitor-community/keep-awake";

interface ScreensaverProps {
  onExit: () => void;
  connectionStatus: ConnectionStatus;
  isActive: boolean;
}

export const Screensaver: React.FC<ScreensaverProps> = ({
  onExit,
  connectionStatus,
  isActive,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showExit, setShowExit] = useState(false);
  const [longPressProgress, setLongPressProgress] = useState(0);

  const isConnected = connectionStatus === ConnectionStatus.CONNECTED;

  // WakeLock: Prevent screen from turning off (Mobile + Web)
  useEffect(() => {
    let wakeLock: any = null;

    const requestWakeLock = async () => {
      try {
        // Capacitor Android/iOS Keep Awake
        await KeepAwake.keepAwake();
        
        // standard Web WakeLock API fallback
        if ('wakeLock' in navigator) {
          // @ts-ignore
          wakeLock = await navigator.wakeLock.request('screen');
        }
      } catch (err: any) {
        console.warn(`WakeLock Error: ${err.message}`);
      }
    };

    const releaseWakeLock = async () => {
      try {
        await KeepAwake.allowSleep();
        if (wakeLock !== null) {
          await wakeLock.release();
          wakeLock = null;
        }
      } catch (err: any) {
        console.warn(`WakeLock Release Error: ${err.message}`);
      }
    };

    if (isActive) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }

    return () => {
      releaseWakeLock();
    };
  }, [isActive]);

  // Auto-hide the exit button if not pressed for 3 seconds

  useEffect(() => {
    if (showExit) {
      const timer = setTimeout(() => setShowExit(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [showExit]);

  // Handle Long Press Logic
  useEffect(() => {
    let frame: number;
    if (longPressProgress > 0 && longPressProgress < 100) {
      frame = requestAnimationFrame(() => {
        setLongPressProgress((p) => Math.min(p + 2, 100)); // ~800ms to fill
      });
    } else if (longPressProgress >= 100) {
      onExit();
      setLongPressProgress(0); // Reset after expanding
    }
    return () => cancelAnimationFrame(frame);
  }, [longPressProgress, onExit]);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    setLongPressProgress(1); // Start progressive fill
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    e.stopPropagation();
    setLongPressProgress(0); // Cancel
  };

  // Canvas Animation Logic
  useEffect(() => {
    if (!isActive) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles: {
      x: number;
      y: number;
      angle: number;
      radius: number;
      speed: number;
      color: string;
    }[] = [];
    const numParticles = 150;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    for (let i = 0; i < numParticles; i++) {
      particles.push({
        x: centerX,
        y: centerY,
        angle: Math.random() * Math.PI * 2,
        radius: Math.random() * (Math.min(centerX, centerY) * 0.8),
        speed: 0.001 + Math.random() * 0.003,
        color:
          Math.random() > 0.5
            ? "rgba(0, 255, 100, 0.15)"
            : "rgba(255, 0, 150, 0.15)",
      });
    }

    let animationFrameId: number;

    const draw = () => {
      // Very dark trail effect for AMOLED
      ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw a subtle singularity center
      ctx.beginPath();
      ctx.arc(
        centerX,
        centerY,
        30 + Math.sin(Date.now() / 1000) * 5,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = "rgba(5, 5, 5, 1)";
      ctx.shadowBlur = 20;
      ctx.shadowColor = "rgba(20, 20, 20, 0.5)";
      ctx.fill();
      ctx.shadowBlur = 0; // Reset

      // Draw rotating data motes
      particles.forEach((p) => {
        p.angle += p.speed;
        p.radius += Math.sin(Date.now() / 2000 + p.angle) * 0.1; // Gentle breathing pulse

        const pX = centerX + Math.cos(p.angle) * p.radius;
        const pY = centerY + Math.sin(p.angle) * p.radius;

        ctx.beginPath();
        ctx.arc(pX, pY, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      });

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", handleResize);
    };
  }, [isActive]);

  if (!isActive) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 1 } }}
      className="fixed inset-0 z-50 bg-black cursor-crosshair overflow-hidden touch-none"
      onClick={() => setShowExit(true)}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block w-full h-full"
      />

      {/* Glowing Singularity Text & Subtle Status */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none text-center opacity-10">
        <div className="text-[0.6rem] font-mono tracking-[0.5em] text-white">
          VORTEX {PROJECT_VERSION.split(' ')[0]}
        </div>
      </div>

      <AnimatePresence>
        {showExit && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-16 left-1/2 -translate-x-1/2 flex flex-col items-center"
          >
            <button
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              className={`relative px-8 py-3 bg-black/40 border backdrop-blur-sm rounded-full overflow-hidden select-none transition-colors duration-300 ${
                isConnected ? "border-green-500/30" : "border-red-500/50"
              }`}
              style={{ WebkitTapHighlightColor: "transparent" }}
            >
              {/* Pulse Glow Effect behind the button depending on status */}
              <div
                className={`absolute inset-0 opacity-20 blur-md ${isConnected ? "bg-green-500" : "bg-red-500"}`}
              ></div>

              {/* Progress Fill Bar */}
              <div
                className={`absolute left-0 bottom-0 h-1 opacity-50 ${isConnected ? "bg-green-400" : "bg-red-500"}`}
                style={{ width: `${longPressProgress}%` }}
              />

              <span className="relative z-10 text-xs font-mono tracking-widest text-slate-300">
                HOLD TO EXIT
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
