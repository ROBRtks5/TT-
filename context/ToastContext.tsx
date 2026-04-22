/**
 * TITAN TRADING BOT - TOAST CONTEXT
 * ---------------------------------------------------------
 * @module context/ToastContext.tsx
 * @version 1.1.0
 * @phase Phase 1: Foundation
 * @last-updated 2025-05-21
 * @description
 * Управление всплывающими уведомлениями (Toasts).
 * Поддерживает типы SUCCESS, ERROR, INFO, WARNING с разным временем жизни.
 * ---------------------------------------------------------
 */

import React, { createContext, useState, useContext, ReactNode, useCallback } from 'react';
import { LogType } from '../types';

type ToastUIType = 'SUCCESS' | 'ERROR' | 'INFO' | 'WARNING';

export interface Toast {
  id: number;
  message: string;
  type: ToastUIType;
  duration: number;
}

interface ToastContextType {
  toasts: Toast[];
  addToast: (message: string, type: LogType) => void;
  removeToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

// Map LogType to a simpler set for UI
const mapLogTypeToToastType = (type: LogType): ToastUIType => {
    switch (type) {
        case LogType.SUCCESS: return 'SUCCESS';
        case LogType.ERROR: return 'ERROR';
        case LogType.WARNING: return 'WARNING';
        default: return 'INFO';
    }
};

// Smart duration based on importance
const getDuration = (type: ToastUIType): number => {
    switch (type) {
        case 'ERROR': return 8000;   // Errors need time to be read
        case 'WARNING': return 6000;
        case 'INFO': return 5000;
        case 'SUCCESS': return 4000; // Success can be quick
        default: return 5000;
    }
};

let toastIdCounter = 0;

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: number) => {
    setToasts(prevToasts => prevToasts.filter(toast => toast.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: LogType) => {
    const uiType = mapLogTypeToToastType(type);
    
    // Anti-Spam: Don't add if exact same message already exists
    setToasts(currentToasts => {
        if (currentToasts.some(t => t.message === message)) {
            return currentToasts;
        }
        
        const id = toastIdCounter++;
        const duration = getDuration(uiType);
        
        // Set auto-dismiss
        setTimeout(() => {
            removeToast(id);
        }, duration);

        return [...currentToasts, { id, message, type: uiType, duration }];
    });
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextType => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};