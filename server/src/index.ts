import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { allAdapters } from './adapters/registry';
import { AnalysisService } from './analyzers/index';
import { AuthService } from './auth/service';
import { loadDotEnv } from './config/dotenv';
import { currentUser, parseServerArgs, readServerEnv } from './config/env';
import { ConfigStore, resolveHome, resolvePaths } from './config/store';
import { SessionIndex } from './index/session-index';
import { EnrichService } from './llm/service';
import { createWikiServices } from './wiki/service';
import { cloudConfig } from './cloud/client';
import { SupabaseAuth } from './auth/supabase';
import { userLlmEnvironment } from './llm/credentials';
import { procNetAvailable } from './lib/peer';
import { resolveLayout } from './config/layout';
import { OpenRouterKeyStore, withSavedKey } from './llm/key-store';
import { isAppRunning, openUrl } from './lib/open-url';

const here = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '0.1.0';

async function main() {
  // 저장소 실행은 .env → .env.admin, 배포 묶음은 묶음 폴더의 .env → app/release.env 순서로 읽는다 (앞의 값이 우선).
  const layout = resolveLayout(here);
  for (const file of layout.envFiles) {
    const dotenv = loadDotEnv(file);
    if (dotenv.loaded && !file.endsWith('.env.admin')) console.log(`[vibe-teacher] ${path.basename(file)} 를 읽었습니다 (${dotenv.keys.length ? dotenv.keys.join(', ') : '새 값 없음 — 셸 환경변수가 우선'})`);
  }
  const args = parseServerArgs(process.argv.slice(2));
  const paths = resolvePaths(args.home ?? resolveHome());
  const store = new ConfigStore(paths);
  await store.load();
  const cfg = store.get();
  const env = readServerEnv(cfg.server, process.env, args);
  const cloud = cloudConfig();
  if (cloud?.deployment === 'local' && !env.isLoopback) throw new Error('로컬 설치는 loopback 주소에서 실행하세요. 공용 서버는 VIBE_TEACHER_DEPLOYMENT=shared로 지정하세요');
  if (cloud?.deployment === 'ssh') {
    // 다른 기기에서 직접 들어온 연결은 접속한 OS 계정을 알 수 없으므로 SSH 터널로만 받는다.
    if (!env.isLoopback) throw new Error('SSH 터널 서버는 loopback 주소(기본 127.0.0.1)에서 실행하세요. 사용자는 ssh -L 로 접속합니다');
    if (!procNetAvailable()) throw new Error('SSH 터널 서버는 접속한 OS 계정을 /proc/net/tcp 에서 확인하므로 리눅스에서만 실행할 수 있습니다');
  }
  if (!env.isLoopback && !env.token && cfg.auth.mode !== 'home-token' && !cloud) {
    console.error(
      `[vibe-teacher] ${env.host} 처럼 loopback 이 아닌 주소에 바인딩하려면 VIBE_TEACHER_TOKEN 환경변수 또는 로그인 모드(auth.mode=home-token)가 필요합니다. ` +
        `여러 계정의 대화 기록을 다루므로 SSH 터널(ssh -L ${env.port}:127.0.0.1:${env.port} <server>) 사용을 권장합니다.`,
    );
    process.exit(2);
  }
  const appUrl = `http://127.0.0.1:${env.port}/`;
  if (layout.packaged && await isAppRunning(appUrl)) {
    // 실행 파일을 두 번 눌렀을 때: 새로 띄우지 않고 이미 실행 중인 화면만 연다.
    console.log(`[vibe-teacher] 이미 실행 중입니다. 브라우저에서 ${appUrl} 을 엽니다.`);
    if (!(await openUrl(appUrl))) console.log(`[vibe-teacher] 브라우저 주소창에 ${appUrl} 을 입력하세요.`);
    return;
  }

  const index = new SessionIndex({
    adapters: allAdapters(),
    store,
    cacheDir: paths.indexCacheDir,
    hiddenRoot: paths.home,
    log: (m) => console.log(m),
  });
  const analysis = new AnalysisService();
  // 노트북 설치는 화면에서 저장한 OpenRouter 키를 쓸 수 있다. 셸·.env 의 키가 우선한다.
  const openRouterKey = cloud?.deployment === 'local' ? OpenRouterKeyStore.at(paths.home) : undefined;
  await openRouterKey?.load();
  const enrich = new EnrichService({ store, paths, env: userLlmEnvironment({ isAdmin: true }, cloud?.deployment ?? 'local', cfg.llm.provider, withSavedKey(process.env, openRouterKey)) });
  const auth = new AuthService({ store, paths, index, serviceUser: currentUser().username, serviceUid: currentUser().uid, bearerToken: env.token, isLoopback: env.isLoopback, cookieSecure: process.env.VIBE_TEACHER_COOKIE_SECURE === '1', ...(cloud ? { cloud: new SupabaseAuth(cloud, paths.home) } : {}) });
  await auth.init();
  const { wiki, learner, assessments, wikiAi, help, prefs, memory } = createWikiServices(paths.home, store, () => enrich.resolveProvider(), (id) => index.getProjectIds(id));

  const app = createApp({
    deps: { store, index, paths, analysis, enrich, auth, wiki, learner, assessments, wikiAi, help, prefs, memory, ...(openRouterKey ? { openRouterKey } : {}), version: VERSION },
    distDir: layout.distDir,
  });

  const first = await index.rescan();
  console.log(
    `[vibe-teacher] 계정 ${first.accounts}개, 소스 ${first.sources}개, 프로젝트 ${first.projects}개, 세션 ${first.sessions}개 (${first.durationMs}ms)`,
  );
  const server = serve({ fetch: app.fetch, hostname: env.host, port: env.port }, (info) => {
    console.log(`[vibe-teacher] http://${info.address === '::' ? 'localhost' : info.address}:${info.port}  (설정: ${paths.configFile})`);
    console.log(`[vibe-teacher] 로그인 모드: ${auth.mode()}${cloud ? ` · ${cloud.deployment} · Supabase 사용자별 저장${cloud.deployment === 'ssh' ? ' · 접속한 SSH 계정의 기록만 표시' : ''}` : ''}${cfg.auth.mode === 'home-token' ? ` · 관리자: ${[currentUser().username, ...cfg.auth.admins].join(', ')}` : ''}`);
    if (layout.packaged) {
      console.log('[vibe-teacher] 이 창을 닫으면 Vibe Teacher 가 종료됩니다. 쓰는 동안에는 창을 열어 두세요.');
      void openUrl(appUrl).then((opened) => { if (!opened) console.log(`[vibe-teacher] 브라우저 주소창에 ${appUrl} 을 입력하세요.`); });
    }
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[vibe-teacher] ${env.port} 포트를 다른 프로그램이 쓰고 있습니다. 그 프로그램을 끄거나 VIBE_TEACHER_PORT 로 다른 포트를 지정하세요${layout.packaged ? ' (묶음 폴더의 .env 파일에 VIBE_TEACHER_PORT=3328 처럼 적습니다)' : ''}.`);
    } else {
      console.error(err);
    }
    process.exit(1);
  });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(0), 10000).unref();
    server.close(() => { void memory.close().finally(() => { clearTimeout(deadline); process.exit(0); }); });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
