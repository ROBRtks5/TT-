
import { CapacitorConfig } from '@capacitor/cli';

/**
 * TITAN CAPACITOR CONFIGURATION
 * --------------------------------
 * Protocol Exodus: Android Bridge
 * --------------------------------
 */
const config: CapacitorConfig = {
  appId: 'com.titan.trading.bot',
  appName: 'VORTEX 2.1',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    // Background Mode Plugin Config (for future reference)
    // "BackgroundRunner": { ... }
  },
  android: {
    allowMixedContent: true, // Allow fetching from non-https APIs if needed (unlikely but safe)
    backgroundColor: "#050505"
  }
};

export default config;
