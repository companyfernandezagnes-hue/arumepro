import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  // ✅ Ruta base para GitHub Pages y móvil
  base: process.env.GITHUB_ACTIONS ? '/arumepro/' : '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react'   : ['react', 'react-dom'],
          'vendor-charts'  : ['recharts'],
          'vendor-motion'  : ['motion'],
          'vendor-icons'   : ['lucide-react'],
          'vendor-services': ['@supabase/supabase-js', '@react-oauth/google'],
          'vendor-pdf-gen' : ['jspdf', 'jspdf-autotable'],
          'vendor-xlsx'    : ['xlsx'],
          'vendor-ocr'     : ['tesseract.js'],
          'vendor-pdf'     : ['pdfjs-dist'],
        },
      },
    },
    // Subido a 900 para xlsx (~800kB minificado) — informativo, no bloquea el build
    chunkSizeWarningLimit: 900,
  },
  server: {
    hmr: process.env.DISABLE_HMR !== 'true',
  },
});
