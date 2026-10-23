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

const here = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '0.1.0';

async function main() {
  const dotenv = loadDotEnv(path.resolve(here, '../../.env'));
  if (dotenv.loaded) console.log(`[vibe-teacher] .env 를 읽었습니다 (${dotenv.keys.length ? dotenv.keys.join(', ') : '새 값 없음 — 셸 환경변수가 우선'})`);
  const args = parseServerArgs(process.argv.slice(2));
  const paths = resolvePaths(args.home ?? resolveHome());
  const store = new ConfigStore(paths);
  await store.load();
  const cfg = store.get();
  const env = readServerEnv(cfg.server, process.env, args);
  if (!env.isLoopback && !env.token && cfg.auth.mode !== 'home-token') {
    console.error(
      `[vibe-teacher] ${env.host} 처럼 loopback 이 아닌 주소에 바인딩하려면 VIBE_TEACHER_TOKEN 환경변수 또는 로그인 모드(auth.mode=home-token)가 필요합니다. ` +
        `여러 계정의 대화 기록을 다루므로 SSH 터널(ssh -L 8787:127.0.0.1:8787 <server>) 사용을 권장합니다.`,
    );
    process.exit(2);
  }

  const index = new SessionIndex({
    adapters: allAdapters(),
    store,
    cacheDir: paths.indexCacheDir,
    hiddenRoot: paths.home,
    log: (m) => console.log(m),
  });
  const analysis = new AnalysisService();
  const enrich = new EnrichService({ store, paths });
  const auth = new AuthService({ store, paths, index, serviceUser: currentUser().username, bearerToken: env.token, isLoopback: env.isLoopback, cookieSecure: process.env.VIBE_TEACHER_COOKIE_SECURE === '1' });
  await auth.init();
  const { wiki, learner, assessments, wikiAi, help, prefs } = createWikiServices(paths.home, store, () => enrich.resolveProvider(), (id) => index.getProjectIds(id));

  const app = createApp({
    deps: { store, index, paths, analysis, enrich, auth, wiki, learner, assessments, wikiAi, help, prefs, version: VERSION },
    distDir: path.resolve(here, '../../web/dist'),
  });

  const first = await index.rescan();
  console.log(
    `[vibe-teacher] 계정 ${first.accounts}개, 소스 ${first.sources}개, 프로젝트 ${first.projects}개, 세션 ${first.sessions}개 (${first.durationMs}ms)`,
  );
  serve({ fetch: app.fetch, hostname: env.host, port: env.port }, (info) => {
    console.log(`[vibe-teacher] http://${info.address === '::' ? 'localhost' : info.address}:${info.port}  (설정: ${paths.configFile})`);
    console.log(`[vibe-teacher] 로그인 모드: ${cfg.auth.mode}${cfg.auth.mode === 'home-token' ? ` · 관리자: ${[currentUser().username, ...cfg.auth.admins].join(', ')}` : ''}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
