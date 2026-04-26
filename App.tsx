
/**
 * TITAN TRADING BOT - ROOT COMPONENT
 * ---------------------------------------------------------
 * @module App.tsx
 * @version 35.4.0 (SYSTEM HARMONIZATION)
 * @phase System Harmonization
 * @last-updated 2026-01-02
 * ---------------------------------------------------------
 */

import React, { useEffect } from 'react';
import Dashboard from './components/Dashboard';
import AndroidShell from './components/AndroidShell';
import { ToastProvider } from './context/ToastContext';
import { UIProvider } from './context/UIContext';
import ToastContainer from './components/ui/ToastContainer';
import SystemGuardian from './components/SystemGuardian';

function App() {
  // Manual Splash Cleanup - WITH DELAY FOR IMMERSION
  useEffect(() => {
    const cleanupSplash = () => {
        const splash = document.getElementById('titan-splash');
        if (splash) {
            splash.style.opacity = '0';
            // Give CSS transition time, then force remove
            setTimeout(() => {
                if (splash.parentNode) splash.parentNode.removeChild(splash);
            }, 500);
        }
    };

    // Delay the cleanup for 2500ms so the user can see the animated Vortex splash screen on Android/Web
    const loadingTimer = setTimeout(() => {
        cleanupSplash();
    }, 2500);

    return () => clearTimeout(loadingTimer);
  }, []);

  return (
    <SystemGuardian>
      <UIProvider>
        <ToastProvider>
          <AndroidShell /> 
          {/* FULL SCREEN CONTAINER: No padding, no margins. The Dashboard handles its own layout. */}
          <main className="w-full h-[100dvh] overflow-hidden bg-black scanlines relative">
            <Dashboard />
          </main>
          <ToastContainer />
        </ToastProvider>
      </UIProvider>
    </SystemGuardian>
  );
}

export default App;
