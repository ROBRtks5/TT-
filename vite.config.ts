import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

// Fix for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // CRITICAL FOR CAPACITOR: Use relative paths for assets
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext', // Optimize for modern Android WebViews
    sourcemap: false, // Disable source maps for production build to save space
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
        output: {
            manualChunks: {
                vendor: ['react', 'react-dom', 'recharts'],
                capacitor: ['@capacitor/core', '@capacitor/app', '@capacitor/haptics']
            }
        }
    }
  },
  server: {
    host: true, // Expose for network testing
    port: 5173
  }
});