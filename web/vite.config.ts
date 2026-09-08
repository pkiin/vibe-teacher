import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 포트/주소는 환경변수로 정한다 (scripts/dev.mjs 가 CLI 인자를 환경변수로 옮겨 준다).
 * - VIBE_TEACHER_WEB_PORT / VIBE_TEACHER_WEB_HOST : 이 개발 서버
 * - VIBE_TEACHER_PORT (+ VIBE_TEACHER_API_URL)     : /api 프록시 대상 (Hono 서버)
 * vite CLI 의 --port / --host 를 직접 주면 그 값이 우선한다.
 */
const webPort = Number(process.env.VIBE_TEACHER_WEB_PORT) || 5173;
const webHost = process.env.VIBE_TEACHER_WEB_HOST || '127.0.0.1';
const apiPort = Number(process.env.VIBE_TEACHER_PORT) || 8787;
const apiUrl = process.env.VIBE_TEACHER_API_URL || `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: webPort,
    host: webHost,
    strictPort: true,
    proxy: {
      '/api': { target: apiUrl, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
