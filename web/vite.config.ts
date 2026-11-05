import type { Socket } from 'node:net';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { PEER_UID_HEADER, readPeerUidSync } from '../server/src/lib/peer';

/**
 * 포트/주소는 환경변수로 정한다 (scripts/dev.mjs 가 CLI 인자를 환경변수로 옮겨 준다).
 * - VIBE_TEACHER_WEB_PORT / VIBE_TEACHER_WEB_HOST : 이 개발 서버
 * - VIBE_TEACHER_PORT (+ VIBE_TEACHER_API_URL)     : /api 프록시 대상 (Hono 서버)
 * vite CLI 의 --port / --host 를 직접 주면 그 값이 우선한다.
 */
const webPort = Number(process.env.VIBE_TEACHER_WEB_PORT) || 3317;
const webHost = process.env.VIBE_TEACHER_WEB_HOST || '127.0.0.1';
const apiPort = Number(process.env.VIBE_TEACHER_PORT) || 3318;
const apiUrl = process.env.VIBE_TEACHER_API_URL || `http://127.0.0.1:${apiPort}`;

/**
 * SSH 터널 서버(VIBE_TEACHER_DEPLOYMENT=ssh)는 연결을 연 OS 계정으로 볼 기록을 정한다.
 * 프록시를 거치면 API 에는 이 개발 서버의 계정으로 보이므로, 원래 접속자의 uid 를 헤더로 넘긴다.
 * API 는 서버와 같은 계정이 연 연결의 헤더만 믿고, 브라우저가 보낸 같은 이름의 헤더는 여기서 덮어쓴다.
 */
const peerUids = new WeakMap<Socket, number | null>();

export default defineConfig({
  plugins: [react()],
  server: {
    port: webPort,
    host: webHost,
    strictPort: true,
    proxy: {
      '/api': {
        target: apiUrl,
        changeOrigin: true,
        configure: (proxy) => proxy.on('proxyReq', (proxyReq, req) => {
          let uid = peerUids.get(req.socket);
          if (uid === undefined) {
            uid = readPeerUidSync(req.socket);
            peerUids.set(req.socket, uid);
          }
          proxyReq.setHeader(PEER_UID_HEADER, uid === null ? '' : String(uid));
        }),
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
