
/**
 * TITAN TRADING BOT - UI CONTEXT
 * ---------------------------------------------------------
 * @module context/UIContext.tsx
 * @version 1.4.0 (CLEAN)
 * @phase Phase 7: Cleanup
 * @description
 * Контекст для управления состоянием UI.
 * Удалены ссылки на устаревшие модальные окна.
 * ---------------------------------------------------------
 */
import React, { createContext, useState, useContext, ReactNode, useCallback, useEffect } from 'react';

const API_KEY_STORAGE_KEY = 'tbank-api-key';
const GEMINI_API_STORAGE_KEY = 'gemini-api-key';

interface UIContextType {
    isApiKeyModalOpen: boolean;
    isKeyRequired: boolean;
    storedApiKey: string | null;
    setIsApiKeyModalOpen: (isOpen: boolean) => void;
    handleSaveApiKey: (apiKey: string, geminiKey?: string) => void;
    clearStoredApiKeyAndShowModal: () => void;
    setIsKeyRequired: (isRequired: boolean) => void;
}

const UIContext = createContext<UIContextType | undefined>(undefined);

export const UIProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
    const [isKeyRequired, setIsKeyRequired] = useState(false);
    const [storedApiKey, setStoredApiKey] = useState<string | null>(null);

    useEffect(() => {
        const key = localStorage.getItem(API_KEY_STORAGE_KEY);
        if (key) {
            setStoredApiKey(key);
            setIsKeyRequired(false);
        } else {
            setIsKeyRequired(true);
        }
    }, []);

    const handleSaveApiKey = useCallback((apiKey: string, geminiKey?: string) => {
        localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
        if (geminiKey) {
            localStorage.setItem(GEMINI_API_STORAGE_KEY, geminiKey);
        }
        setStoredApiKey(apiKey);
        setIsKeyRequired(false);
        setIsApiKeyModalOpen(false);
    }, []);

    const clearStoredApiKeyAndShowModal = useCallback(() => {
        localStorage.removeItem(API_KEY_STORAGE_KEY);
        setStoredApiKey(null);
        setIsKeyRequired(true);
        setIsApiKeyModalOpen(true);
    }, []);
    
    const value = {
        isApiKeyModalOpen,
        isKeyRequired,
        storedApiKey,
        setIsApiKeyModalOpen: useCallback((isOpen: boolean) => setIsApiKeyModalOpen(isOpen), []),
        handleSaveApiKey,
        clearStoredApiKeyAndShowModal,
        setIsKeyRequired: useCallback((isRequired: boolean) => setIsKeyRequired(isRequired), []),
    };

    return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
};

export const useUI = (): UIContextType => {
    const context = useContext(UIContext);
    if (!context) {
        throw new Error('useUI must be used within a UIProvider');
    }
    return context;
};
