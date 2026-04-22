
import React from 'react';
import { useToast, Toast as ToastType } from '../../context/ToastContext';

type ToastUIType = 'SUCCESS' | 'ERROR' | 'INFO' | 'WARNING';

const Toast: React.FC<{ message: string; type: ToastUIType; duration: number; onDismiss: () => void }> = ({ message, type, duration, onDismiss }) => {
    // Holographic Cyberpunk Styles
    const styles = {
        SUCCESS: { 
            border: 'border-l-4 border-cyber-green', 
            bg: 'bg-black/80 shadow-[0_0_15px_rgba(0,255,159,0.2)]', 
            icon: 'text-cyber-green', 
            bar: 'bg-cyber-green' 
        },
        ERROR: { 
            border: 'border-l-4 border-cyber-pink', 
            bg: 'bg-black/80 shadow-[0_0_15px_rgba(255,0,60,0.2)]', 
            icon: 'text-cyber-pink', 
            bar: 'bg-cyber-pink' 
        },
        WARNING: { 
            border: 'border-l-4 border-cyber-yellow', 
            bg: 'bg-black/80 shadow-[0_0_15px_rgba(252,238,10,0.2)]', 
            icon: 'text-cyber-yellow', 
            bar: 'bg-cyber-yellow' 
        },
        INFO: { 
            border: 'border-l-4 border-cyber-cyan', 
            bg: 'bg-black/80 shadow-[0_0_15px_rgba(0,240,255,0.2)]', 
            icon: 'text-cyber-cyan', 
            bar: 'bg-cyber-cyan' 
        },
    }[type];

    const iconMap: Record<ToastUIType, React.ReactNode> = {
        SUCCESS: <span className="text-lg">⚡</span>,
        ERROR: <span className="text-lg">☢️</span>,
        WARNING: <span className="text-lg">⚠️</span>,
        INFO: <span className="text-lg">💠</span>,
    };

    return (
        <div className={`relative w-full max-w-sm rounded-r-lg overflow-hidden backdrop-blur-md border-t border-b border-r border-gray-700/50 ${styles.border} ${styles.bg} animate-fade-in-up transition-all mb-3 group`}>
            {/* Tech Decoration */}
            <div className="absolute top-0 right-0 p-1">
                <div className={`w-1 h-1 rounded-full ${styles.bar} animate-pulse`}></div>
            </div>

            <div className="p-4 flex items-start space-x-3">
                <div className={`flex-shrink-0 ${styles.icon} mt-0.5`}>
                    {iconMap[type]}
                </div>
                <div className="flex-1">
                    <p className="text-xs font-mono text-gray-200 leading-relaxed shadow-black drop-shadow-md">{message}</p>
                </div>
                <button onClick={onDismiss} className="flex-shrink-0 ml-4 text-gray-500 hover:text-white transition-colors focus:outline-none">
                    ✕
                </button>
            </div>
            
            {/* Progress Bar with Dynamic Duration */}
            <div 
                className={`h-0.5 w-full ${styles.bar} animate-progress absolute bottom-0 left-0`} 
                style={{ animationDuration: `${duration}ms` }}
            ></div>
        </div>
    );
};

const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToast();

  return (
    <div 
        className="fixed top-0 right-0 z-[99999] flex flex-col items-end space-y-3 pointer-events-none w-full max-w-sm mt-4 px-2"
        style={{
            paddingTop: 'env(safe-area-inset-top)',
            paddingRight: 'env(safe-area-inset-right)'
        }}
    >
        {/* Pointer events none on container allows clicking through gaps, pointer events auto on items restores interaction */}
      {toasts.map(toast => (
        <div key={toast.id} className="pointer-events-auto w-full">
             <Toast
              message={toast.message}
              type={toast.type}
              duration={toast.duration}
              onDismiss={() => removeToast(toast.id)}
            />
        </div>
      ))}
    </div>
  );
};

export default ToastContainer;
