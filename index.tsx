
/**
 * ------------------------------------------------------------------
 * 🤖 TITAN PROTOCOL: AI PRIME DIRECTIVE (DO NOT REMOVE)
 * ------------------------------------------------------------------
 * TO THE AI AGENT EDITING THIS CODE:
 * 
 * 1.  **THE IRON LAW**: This application runs under the "System Guardian".
 *     If you modify `PROJECT_VERSION` in `constants.ts`, you MUST add a corresponding 
 *     entry to `evolution_log` in `TITAN_MEMORY.json`.
 *     
 * 2.  **CONSEQUENCE**: Failure to update `TITAN_MEMORY.json` with the new version 
 *     and a description of changes will trigger a "PROTOCOL VIOLATION" screen, 
 *     rendering the app unusable.
 *     
 * 3.  **AUTOMATION**: You are the Scribe. Do not ask the user to document changes. 
 *     YOU document changes as part of the commit.
 *     
 * 4.  **CONTEXT**: Before answering, ingest `TITAN_MEMORY.json` to understand 
 *     the architectural state.
 * ------------------------------------------------------------------
 */

/**
 * TITAN TRADING BOT - ENTRY POINT
 * ---------------------------------------------------------
 * @module index.tsx
 * @version 35.4.0 (SYSTEM HARMONIZATION)
 * @phase System Harmonization
 * @last-updated 2026-01-02
 * ---------------------------------------------------------
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import SafeBootGuard from './components/SafeBootGuard'; 
import * as dataVaultService from './services/dataVaultService';
import './index.css';

// GLOBALS
declare global {
    interface Window {
        titanReport: (msg: string) => void;
    }
}

// --- BOOT REPORTER ---
if (window.titanReport) {
    window.titanReport("BOOT: Script Loaded. Mounting React...");
}

// --- CONNECTIVITY PROBE (DIAGNOSTIC) ---
// Fires immediately to check if the environment is hostile (blocked)
(async () => {
    try {
        const start = Date.now();
        const res = await fetch('https://invest-public-api.tinkoff.ru/rest/tinkoff.public.invest.api.contract.v1.InstrumentsService/GetInstrumentBy', { 
            method: 'POST', 
            body: '{}' // Invalid body but should return 401/400, not Network Error
        });
        const latency = Date.now() - start;
        if(window.titanReport) window.titanReport(`📡 NetProbe: Reachable (${latency}ms). Status: ${res.status}`);
    } catch(e: any) {
        if(window.titanReport) window.titanReport(`⛔ NetProbe FAIL: ${e.message}. Possible CORS/Block.`);
    }
})();

// --- GLOBAL BLACK BOX PROTOCOL ---
window.addEventListener('error', (event) => {
    if (event.error) {
        dataVaultService.recordSystemCrash(event.error, 'Глобальная область ошибок');
        document.body.classList.add('react-crashed'); 
        if(window.titanReport) window.titanReport(`FATAL: ${event.error.message}`);
    }
});

window.addEventListener('unhandledrejection', (event) => {
    let reasonMsg = 'Unknown Promise Rejection';
    try {
        const reason = event.reason;
        if (reason instanceof Error) {
            reasonMsg = reason.message;
        } else if (typeof reason === 'string') {
            reasonMsg = reason;
        } else {
            reasonMsg = JSON.stringify(reason);
        }
    } catch(e) {
        reasonMsg = String(event.reason);
    }
    
    const error = new Error(reasonMsg);
    dataVaultService.recordSystemCrash(error, 'Необработанное отклонение промиса');
    console.error("Unhandled Rejection:", reasonMsg);
});
// --- END PROTOCOL ---

// --- SERVICE WORKER (PWA) ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(registration => {
      // console.log('SW зарегистрирован: ', registration); // Silenced for production
    }).catch(registrationError => {
      // console.log('SW регистрация не удалась: ', registrationError);
    });
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Не удалось найти корневой элемент для монтирования");
}

// SAFE MOUNT
try {
    const root = ReactDOM.createRoot(rootElement);
    if (window.titanReport) window.titanReport("BOOT: Render Cycle Started...");
    
    root.render(
      <React.StrictMode>
        <SafeBootGuard>
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
        </SafeBootGuard>
      </React.StrictMode>
    );
} catch (e: any) {
    console.error("FATAL REACT MOUNT ERROR:", e);
    // Explicitly update splash to show we failed here
    const errEl = document.getElementById('splash-error');
    if(errEl) {
        errEl.style.display = 'block';
        errEl.innerText = `FATAL: React Failed to Mount.\n${e.message}`;
    }
    if (window.titanReport) window.titanReport(`CRASH: ${e.message}`);
}
