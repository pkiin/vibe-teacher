import path from 'node:path';
import type { BuiltSummary, RepoBlock, RepoFacts, RepoListItem, RepoSection, RepoSource, RepoWiki, RiskFinding } from '@vibe-teacher/shared';
import { languageFor } from '../analyzers/built/files';
import { shortId } from '../lib/hash';
import { truncate } from '../lib/text';
import type { RepoScan } from './scan';
import { codeFlow } from './code';

/**
 * 레포 위키 조립 (규칙 기반). 저장소 스캔과 세션 요약만으로 만들며, 추정한 부분은 note 로 밝힌다.
 *  - 사용자 중심: 무엇인가 · 제공 기능 · 설치와 실행 · 설정할 것 · 알아 둘 점 · 변경 이력
 *  - 기능·동작 중심: 폴더 구조와 역할 · 기술 스택 · 시작 파일과 실행 순서 · API·라우트 · 데이터와 외부 연동 · 테스트와 검증 · 주의할 동작
 */
export const REPO_WIKI_VERSION = 'repo-rules-0.3';

export interface RepoSessionDigest {
  key: string;
  title: string;
  at?: string;
  mtime?: number;
  request?: string;
  oneLiner?: string;
  features: { name: string; detail: string }[];
  built: BuiltSummary;
  findings: RiskFinding[];
  /** 위키가 없는 세션과, 점검했지만 항목이 없는 세션을 구분한다. */
  securityReviewed?: boolean;
}

const sessionSrc = (s: RepoSessionDigest): RepoSource => ({ kind: 'session', key: s.key, title: s.title });
const fileSrc = (p: string): RepoSource => ({ kind: 'file', path: p });

// ---- README ----

interface MdSection {
  heading: string;
  level: number;
  body: string;
}

export function parseMarkdown(text: string): { title?: string; intro: string; sections: MdSection[] } {
  const lines = text.split('\n');
  const sections: MdSection[] = [];
  let title: string | undefined;
  let cur: MdSection | null = null;
  const intro: string[] = [];
  let fence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) fence = !fence;
    const h = !fence ? /^(#{1,6})\s+(.*)$/.exec(line) : null;
    if (h) {
      if (h[1]!.length === 1 && !title && !cur) {
        title = h[2]!.trim();
        continue;
      }
      cur = { heading: h[2]!.trim(), level: h[1]!.length, body: '' };
      sections.push(cur);
      continue;
    }
    if (cur) cur.body += `${line}\n`;
    else intro.push(line);
  }
  return { ...(title ? { title } : {}), intro: intro.join('\n'), sections };
}

/** 배지·HTML·링크 문법을 걷어 낸 문단들 */
function paragraphs(md: string, max = 2): string[] {
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p && !/^[-*|>]/.test(p))
    .slice(0, max);
}

function bullets(md: string, max = 12): string[] {
  return md
    .split('\n')
    .map((l) => /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(l)?.[1]?.trim())
    .filter((x): x is string => !!x)
    .map((x) => x.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'))
    .slice(0, max);
}

function codeBlocks(md: string, max = 2): { text: string; lang?: string }[] {
  return [...md.matchAll(/```(\w*)\n([\s\S]*?)```/g)].slice(0, max).map((m) => ({ text: m[2]!.trimEnd(), ...(m[1] ? { lang: m[1] } : {}) }));
}

// ---- 이름표 ----

const SCRIPT_ROLE: Record<string, string> = {
  dev: '개발 서버 실행',
  start: '실행 (배포용)',
  build: '공개할 파일 만들기 (빌드)',
  test: '테스트 실행',
  'test:watch': '테스트 (변경 감시)',
  'test:e2e': '브라우저 테스트',
  lint: '코드 검사',
  typecheck: '타입 검사',
  preview: '공개할 파일 미리 보기',
  format: '코드 정리',
};

const DIR_ROLE: [RegExp, string][] = [
  [/^(server|backend|api)$/, '데이터와 요청을 처리하는 서버'],
  [/^(web|client|frontend|app|ui)$/, '사용자가 보는 화면'],
  [/^src$/, '소스 코드'],
  [/^components?$/, '화면 조각(컴포넌트)'],
  [/^(pages|views|screens)$/, '페이지'],
  [/^routes?$/, '라우트(주소별 처리)'],
  [/^(lib|utils?|helpers)$/, '공용 함수'],
  [/^hooks$/, '화면의 상태와 동작을 관리하는 코드'],
  [/^(styles?|css)$/, '스타일'],
  [/^(public|static|assets)$/, '정적 파일'],
  [/^(tests?|__tests__|spec|e2e)$/, '테스트'],
  [/^fixtures$/, '테스트용 예시 데이터'],
  [/^docs?$/, '문서'],
  [/^scripts$/, '보조 스크립트'],
  [/^(config|configs)$/, '설정'],
  [/^data$/, '데이터 파일'],
  [/^(prisma|migrations|db|models|schema)$/, '데이터베이스'],
  [/^(shared|common)$/, '여러 곳에서 함께 쓰는 코드'],
  [/^types$/, '타입 정의'],
  [/^services?$/, '기능을 처리하는 코드'],
  [/^middlewares?$/, '요청을 처리하기 전에 거치는 코드'],
  [/^(i18n|locales?)$/, '번역 문자열'],
  [/^(bin|cli)$/, '명령줄 도구'],
  [/^(adapters?)$/, '외부 형식 변환(어댑터)'],
  [/^(context|store|stores)$/, '화면 상태 관리'],
];

const DEP_LABEL: Record<string, string> = {
  react: 'React — 화면 구성',
  vue: 'Vue — 화면 구성',
  svelte: 'Svelte — 화면 구성',
  next: 'Next.js — React 풀스택 프레임워크',
  vite: 'Vite — 개발 서버·빌드',
  'react-router': 'React Router — 화면 주소 이동',
  'react-router-dom': 'React Router — 화면 주소 이동',
  hono: 'Hono — API 서버',
  express: 'Express — API 서버',
  fastify: 'Fastify — API 서버',
  zod: 'zod — 입력·데이터 형식 검사',
  prisma: 'Prisma — 데이터베이스',
  '@prisma/client': 'Prisma — 데이터베이스',
  'drizzle-orm': 'Drizzle — 데이터베이스',
  pg: 'PostgreSQL 연결',
  mysql2: 'MySQL 연결',
  sqlite3: 'SQLite',
  'better-sqlite3': 'SQLite',
  mongoose: 'MongoDB',
  redis: 'Redis',
  ioredis: 'Redis',
  '@supabase/supabase-js': 'Supabase',
  firebase: 'Firebase',
  stripe: 'Stripe 결제',
  '@anthropic-ai/sdk': 'Anthropic SDK — Claude API',
  openai: 'OpenAI SDK',
  axios: 'axios — HTTP 요청',
  tailwindcss: 'Tailwind CSS — 스타일',
  typescript: 'TypeScript',
  tsx: 'tsx — TypeScript 바로 실행',
  vitest: 'Vitest — 테스트',
  jest: 'Jest — 테스트',
  playwright: 'Playwright — 브라우저 테스트',
  '@playwright/test': 'Playwright — 브라우저 테스트',
  cypress: 'Cypress — 브라우저 테스트',
  eslint: 'ESLint — 코드 검사',
  prettier: 'Prettier — 코드 정리',
  fastapi: 'FastAPI — API 서버',
  flask: 'Flask — API 서버',
  django: 'Django — 웹 프레임워크',
  sqlalchemy: 'SQLAlchemy — 데이터베이스',
  pytest: 'pytest — 테스트',
  streamlit: 'Streamlit — 데이터 앱 화면',
  pandas: 'pandas — 데이터 처리',
  torch: 'PyTorch — 딥러닝',
  transformers: 'Transformers — 언어 모델',
};

const DATA_DEP = /^(prisma|@prisma\/client|drizzle-orm|pg|mysql2|sqlite3|better-sqlite3|mongoose|redis|ioredis|@supabase\/supabase-js|firebase|sqlalchemy|psycopg2.*|pymongo)$/;
const EXTERNAL_DEP = /^(@anthropic-ai\/sdk|openai|anthropic|stripe|@google\/genai|@google\/generative-ai|groq-sdk|@mistralai\/.+|langchain|@langchain\/.+|axios|node-fetch|requests|httpx|twilio|nodemailer|@sendgrid\/.+)$/;

const roleOf = (name: string) => DIR_ROLE.find(([re]) => re.test(name.toLowerCase()))?.[1];

// ---- 조립 ----

export function buildRepoWiki(input: {
  project: { id: string; name: string; rootPath: string };
  scan: RepoScan;
  sessions: RepoSessionDigest[];
  previous: RepoWiki | null;
  now?: Date;
}): RepoWiki {
  const { scan, sessions, project } = input;
  const readme = scan.readme ? parseMarkdown(scan.readme.text) : null;
  const rootPkg = scan.packages.find((p) => p.path === 'package.json') ?? scan.packages[0];
  const allDeps = [...new Set([...scan.packages.flatMap((p) => [...p.dependencies, ...p.devDependencies]), ...(scan.python?.dependencies ?? []).map((d) => d.toLowerCase())])];
  const warnings: string[] = [];
  if (scan.readable === 'denied') warnings.push('저장소 폴더를 읽을 권한이 없어 세션 기록만으로 만들었습니다.');
  if (scan.readable === 'missing') warnings.push('저장소 폴더를 찾지 못해 세션 기록만으로 만들었습니다 (폴더가 옮겨졌거나 다른 컴퓨터일 수 있음).');
  if (scan.truncated) warnings.push(`파일이 많아 처음 ${scan.files.length}개까지만 살펴봤습니다.`);

  // ---------- 사용자 중심 ----------
  const user: RepoSection[] = [];

  const overview: RepoBlock[] = [];
  const overviewSrc: RepoSource[] = [];
  const introParas = readme ? paragraphs(readme.intro) : [];
  if (readme?.title) overview.push({ kind: 'text', text: `**${readme.title}**` });
  if (introParas.length) {
    overview.push(...introParas.map((t) => ({ kind: 'text' as const, text: t })));
    overviewSrc.push(fileSrc(scan.readme!.path));
  } else if (rootPkg?.description) {
    overview.push({ kind: 'text', text: rootPkg.description });
    overviewSrc.push(fileSrc(rootPkg.path));
  }
  const withSummary = sessions.find((s) => s.oneLiner);
  if (!overview.length && withSummary) {
    overview.push({ kind: 'text', text: withSummary.oneLiner! });
    overviewSrc.push(sessionSrc(withSummary));
  }
  if (!overview.length) overview.push({ kind: 'text', text: 'README 나 package.json 설명이 없어 이 레포가 무엇인지 정리하지 못했습니다. 세션 기록의 첫 요청은 "변경 이력"에서 볼 수 있습니다.' });
  user.push({ id: 'overview', title: '어떤 프로젝트인가요?', blocks: overview, sources: overviewSrc });

  const features: RepoListItem[] = [];
  // README 첫머리의 글머리표 목록 → "기능/Features" 절 순으로 (제목에 '기능'이 들어간 아무 절이나 쓰지 않는다)
  const introBullets = readme ? bullets(readme.intro) : [];
  const featSection = readme?.sections.find((x) => /^(주요\s*)?(기능|특징)|^features?\b|^what it does/i.test(x.heading.trim()));
  const readmeFeatures = introBullets.length >= 2 ? introBullets : featSection ? bullets(featSection.body) : [];
  for (const b of readmeFeatures) features.push({ text: b, sources: [fileSrc(scan.readme!.path)] });
  const seenFeat = new Set(features.map((f) => f.text.toLowerCase()));
  for (const s of sessions) {
    for (const f of s.features) {
      const k = f.name.toLowerCase();
      if (seenFeat.has(k)) continue;
      seenFeat.add(k);
      features.push({ text: f.name, detail: f.detail, sources: [sessionSrc(s)] });
    }
  }
  const featureNote = !features.length ? '정리된 기능 목록이 없어 세션에서 한 요청을 보여 줍니다. 세션에서 "AI로 보강"을 하면 만들어진 기능이 여기에 모입니다.' : undefined;
  if (!features.length) for (const s of sessions.slice(0, 10)) if (s.request) features.push({ text: truncate(s.request, 120), sources: [sessionSrc(s)] });
  user.push({ id: 'features', title: '제공하는 기능', blocks: features.length ? [{ kind: 'list', items: features.slice(0, 20) }] : [{ kind: 'text', text: '아직 정리할 기능이 없습니다.' }], sources: [], ...(featureNote ? { note: featureNote } : {}) });

  const usage: RepoBlock[] = [];
  const usageSrc: RepoSource[] = [];
  const usageSection = readme?.sections.find((s) => /(빠른 시작|시작하기|설치|실행|사용법|사용 방법|quick ?start|getting started|install|usage|how to run|run)/i.test(s.heading));
  if (usageSection) {
    usage.push({ kind: 'text', text: `README "${usageSection.heading}"` });
    usage.push(...codeBlocks(usageSection.body).map((c) => ({ kind: 'code' as const, text: c.text, ...(c.lang ? { lang: c.lang } : {}) })));
    usageSrc.push(fileSrc(scan.readme!.path));
  }
  const scriptRows = scan.packages.flatMap((p) => Object.entries(p.scripts).map(([k, v]) => [p.path === 'package.json' ? `npm run ${k}` : `${path.dirname(p.path)}: npm run ${k}`, SCRIPT_ROLE[k] ?? '', truncate(v, 80)]));
  if (scriptRows.length) {
    usage.push({ kind: 'table', head: ['명령', '하는 일', '실제로 실행하는 것'], rows: scriptRows.slice(0, 20) });
    usageSrc.push(...scan.packages.map((p) => fileSrc(p.path)));
  }
  const servers = [...new Map(sessions.flatMap((s) => s.built.serversStarted.map((sv) => [sv.command, { sv, s }] as const))).values()];
  if (servers.length) usage.push({ kind: 'list', items: servers.slice(0, 6).map(({ sv, s }) => ({ text: `세션에서 띄운 서버: \`${truncate(sv.command, 80)}\``, ...(sv.port ? { detail: `포트 ${sv.port}` } : {}), sources: [sessionSrc(s)] })) });
  if (!usage.length) usage.push({ kind: 'text', text: '설치·실행 방법을 찾지 못했습니다 (README 의 설치/실행 절이나 package.json 스크립트가 없음).' });
  user.push({ id: 'usage', title: '설치와 실행', blocks: usage, sources: usageSrc });

  if (scan.envExample?.keys.length) {
    user.push({
      id: 'config',
      title: '설정할 것',
      blocks: [{ kind: 'text', text: `\`${scan.envExample.path}\` 를 \`.env\` 로 복사해 아래 값을 채웁니다. (값은 읽지 않고 이름만 보여 줍니다)` }, { kind: 'list', items: scan.envExample.keys.map((k) => ({ text: `\`${k}\`` })) }],
      sources: [fileSrc(scan.envExample.path)],
    });
  }

  const latestFinding = new Map<string, { f: RiskFinding; s: RepoSessionDigest }>();
  for (const s of sessions) for (const f of s.findings) if (f.lifecycle === 'open' && !latestFinding.has(f.ruleId)) latestFinding.set(f.ruleId, { f, s });
  const important = [...latestFinding.values()].filter(({ f }) => f.impact === 'high' || f.impact === 'medium' || f.category === 'security' || f.category === 'data');
  user.push({
    id: 'cautions',
    title: '알아 둘 점',
    blocks: important.length ? [{ kind: 'list', items: important.map(({ f, s }) => ({ text: f.title, detail: f.statement, sources: [sessionSrc(s)] })) }] : [{ kind: 'text', text: '세션 기록에서 먼저 알려야 할 항목은 찾지 못했습니다. 위험이 없다는 뜻은 아닙니다.' }],
    sources: [],
    note: '각 세션의 위키(먼저 확인할 것)에서 모았습니다. 위키를 만들지 않은 세션은 빠집니다.',
  });

  // 보안 판단은 AI가 다시 쓰지 않는다. 같은 규칙도 세션마다 근거가 달라 모두 남긴다.
  const security = sessions.flatMap((s) => s.findings
    .filter((f) => (f.category === 'security' || f.category === 'data') && (f.lifecycle === 'open' || f.lifecycle === 'recheck_required'))
    .map((f) => ({ f, s })));
  const status = { observed_in_scope: '기록에서 확인', supported_concern: '근거가 있는 우려', needs_check: '추가 확인 필요', insufficient_context: '자료 부족' };
  const impact = { high: '높음', medium: '중간', low: '낮음', undetermined: '아직 판단하기 어려움' };
  const reviewed = sessions.filter((s) => s.securityReviewed === true).length;
  user.push({
    id: 'security',
    title: '보안 및 취약점 점검',
    blocks: [
      { kind: 'text', text: `최근 세션 ${sessions.length}개 중 위키가 만들어진 ${reviewed}개의 점검 기록을 모았습니다. 대화와 실행 기록에 근거한 확인 사항이며, 저장소 전체의 취약점을 검사한 결과는 아닙니다.` },
      ...(security.length ? [{ kind: 'list' as const, items: security.map(({ f, s }) => ({
        text: f.title,
        detail: `[${status[f.evidenceStatus]} · 영향: ${impact[f.impact]}] ${f.statement}${f.checks.length ? `\n확인 방법: ${f.checks.join(' / ')}` : ''}${f.missingContext.length ? `\n더 필요한 자료: ${f.missingContext.join(', ')}` : ''}`,
        sources: [sessionSrc(s)],
      })) }] : [{ kind: 'text' as const, text: '이 기록에서 따로 표시할 보안·데이터 주의사항은 찾지 못했습니다. 아직 검사하지 않은 영역이 있으므로 안전하다는 뜻은 아닙니다.' }]),
      { kind: 'text', text: '**아직 따로 확인해야 할 것** — 아래 항목은 이 화면에서 자동으로 검사하지 않습니다.' },
      { kind: 'list', items: [
        { text: '다른 사람의 정보에 접근할 수 있나요?', detail: '로그아웃한 상태와 일반 사용자 계정으로 관리자 기능과 다른 사람의 데이터 접근이 막히는지 확인해 보세요.' },
        { text: '비밀키가 공개되는 곳에 들어 있나요?', detail: '브라우저 코드, 공유한 파일, 과거 변경 기록에 비밀키가 있는지 확인해 보세요. 이미 공개한 키는 폐기하고 새로 발급해야 합니다.' },
        { text: '잘못된 입력과 반복 요청을 막고 있나요?', detail: '빈 값이나 너무 긴 값을 서버가 거절하는지, 요청이 반복돼 비용이나 저장 횟수가 늘지 않는지 확인해 보세요.' },
        { text: '사용하는 외부 프로그램에 알려진 취약점이 있나요?', detail: '설치한 버전과 공개된 보안 공지를 대조해야 합니다. 이 앱은 취약점 데이터베이스를 조회하거나 검사 명령을 실행하지 않습니다.' },
        { text: '데이터를 지우거나 덮어쓸 때 복구할 수 있나요?', detail: '삭제 전 확인, 백업, 실패했을 때 되돌릴 방법을 확인해 보세요.' },
      ] },
    ],
    sources: [],
    note: '위키를 만들지 않은 세션, 실제 서비스 환경, 설치 버전별 취약점은 확인 범위에 포함되지 않습니다. 새 기록이 생기면 위키를 업데이트해 주세요.',
    origin: 'rule',
  });

  user.push({
    id: 'history',
    title: '변경 이력',
    blocks: sessions.length
      ? [
          {
            kind: 'list',
            items: sessions.slice(0, 30).map((s) => {
              const b = s.built;
              const counts = [b.filesCreated.length ? `새 파일 ${b.filesCreated.length}` : null, b.filesModified.length ? `수정 ${b.filesModified.length}` : null, b.gitCommits.length ? `커밋 ${b.gitCommits.length}` : null].filter(Boolean).join(' · ');
              return { text: `${s.at ? `${s.at.slice(0, 10)} ` : ''}${s.title}`, detail: [s.oneLiner, counts].filter(Boolean).join(' — '), sources: [sessionSrc(s)] };
            }),
          },
        ]
      : [{ kind: 'text', text: '아직 세션이 없습니다.' }],
    sources: [],
  });

  // ---------- 기능·동작 중심 ----------
  const system: RepoSection[] = [];

  const top = new Map<string, { files: number; langs: Map<string, number>; sub: Map<string, number> }>();
  let rootFiles = 0;
  for (const f of scan.files) {
    const parts = f.path.split('/');
    if (parts.length === 1) {
      rootFiles += 1;
      continue;
    }
    const d = top.get(parts[0]!) ?? { files: 0, langs: new Map(), sub: new Map() };
    d.files += 1;
    const lang = languageFor(f.path);
    if (lang) d.langs.set(lang, (d.langs.get(lang) ?? 0) + 1);
    if (parts.length > 2) d.sub.set(parts[1]!, (d.sub.get(parts[1]!) ?? 0) + 1);
    top.set(parts[0]!, d);
  }
  const dirRows = [...top.entries()]
    .sort((a, b) => b[1].files - a[1].files)
    .slice(0, 20)
    .map(([name, d]) => {
      const langs = [...d.langs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([l]) => l).join(', ');
      const sub = [...d.sub.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, c]) => `${n}/(${c})${roleOf(n) ? ` ${roleOf(n)}` : ''}`).join(' · ');
      return [`${name}/`, roleOf(name) ?? '', String(d.files), langs, sub];
    });
  system.push({
    id: 'structure',
    title: '폴더 구조와 역할',
    blocks: scan.readable === 'ok' ? [{ kind: 'table', head: ['폴더', '역할(이름으로 추정)', '파일', '주요 언어', '안쪽 폴더'], rows: dirRows }, { kind: 'text', text: `최상위 파일 ${rootFiles}개 · 전체 ${scan.files.length}개${scan.truncated ? ' (일부만 셈)' : ''}` }] : [{ kind: 'text', text: '저장소를 읽지 못했습니다.' }],
    sources: [],
    note: '역할은 폴더 이름으로 추정했습니다. 외부 프로그램과 실행용 파일 폴더(node_modules, dist 등)는 셈에서 뺐습니다.',
  });

  const langCount = new Map<string, number>();
  for (const f of scan.files) {
    const l = languageFor(f.path);
    if (l) langCount.set(l, (langCount.get(l) ?? 0) + 1);
  }
  const stackItems: RepoListItem[] = [...langCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([l, n]) => ({ text: l, detail: `파일 ${n}개` }));
  for (const d of allDeps) if (DEP_LABEL[d]) stackItems.push({ text: DEP_LABEL[d]!, detail: d, sources: scan.packages.filter((p) => p.dependencies.includes(d) || p.devDependencies.includes(d)).map((p) => fileSrc(p.path)).slice(0, 2) });
  const stackSeen = new Set(stackItems.map((i) => i.text));
  for (const s of sessions) for (const st of s.built.stack) if (!stackSeen.has(st.name) && !DEP_LABEL[st.id]) {
    stackSeen.add(st.name);
    stackItems.push({ text: st.name, detail: '세션 기록에서 감지', sources: [sessionSrc(s)] });
  }
  system.push({ id: 'stack', title: '사용하는 기술', blocks: stackItems.length ? [{ kind: 'list', items: stackItems.slice(0, 30) }] : [{ kind: 'text', text: '감지한 기술이 없습니다.' }], sources: [] });

  const fileSet = new Set(scan.files.map((f) => f.path));
  const entryItems: RepoListItem[] = [];
  for (const p of scan.packages) {
    for (const [k, v] of Object.entries(p.scripts)) {
      if (!['dev', 'start', 'serve'].includes(k)) continue;
      const files = (v.match(/[\w./-]+\.(?:ts|tsx|js|mjs|cjs|py)\b/g) ?? []).map((x) => path.posix.normalize(path.posix.join(path.posix.dirname(p.path), x)));
      entryItems.push({ text: `\`npm run ${k}\`${p.path === 'package.json' ? '' : ` (${path.dirname(p.path)})`}`, detail: files.length ? `시작 파일: ${files.join(', ')}` : truncate(v, 80), sources: [fileSrc(p.path), ...files.filter((x) => fileSet.has(x)).map(fileSrc)] });
    }
    if (p.main) entryItems.push({ text: `${p.name ?? p.path} 의 main`, detail: p.main, sources: [fileSrc(p.path)] });
  }
  for (const cand of ['index.html', 'web/index.html', 'src/main.tsx', 'src/main.ts', 'src/index.ts', 'src/index.js', 'server/src/index.ts', 'server.js', 'index.js', 'main.py', 'app.py', 'manage.py', 'src/app.py']) {
    if (fileSet.has(cand) && !entryItems.some((i) => i.sources?.some((s) => s.kind === 'file' && s.path === cand))) entryItems.push({ text: `\`${cand}\``, detail: '흔히 쓰는 시작 파일 이름', sources: [fileSrc(cand)] });
  }
  const workspaces = rootPkg?.workspaces ?? [];
  system.push({
    id: 'entry',
    title: '시작 파일과 실행 순서',
    blocks: [...(workspaces.length ? [{ kind: 'text' as const, text: `여러 패키지로 나뉜 저장소입니다 (npm workspaces: ${workspaces.join(', ')}).` }] : []), ...(entryItems.length ? [{ kind: 'list' as const, items: entryItems.slice(0, 15) }] : [{ kind: 'text' as const, text: '시작 파일을 찾지 못했습니다.' }])],
    sources: [],
    note: 'package.json 스크립트와 흔한 파일 이름으로 찾았습니다. 실제로 실행해 보지는 않았습니다.',
  });

  if (scan.code?.length) {
    const graph = codeFlow(scan.code, scan.entries ?? []);
    graph.limited ||= !!scan.codeLimited;
    system.push({
      id: 'mechanism', title: '코드 연결과 주요 처리',
      blocks: [
        { kind: 'flow', graph },
        { kind: 'list', items: scan.code.map((file) => ({
          text: `\`${file.path}\``,
          detail: [file.symbols.length ? `주요 함수·클래스: ${file.symbols.map((symbol) => symbol.name).join(', ')}` : '시작 코드와 파일 연결을 확인할 수 있습니다.', file.imports.length ? `연결된 파일: ${file.imports.map((item) => item.path).join(', ')}` : '이 범위에서 연결한 내부 파일을 찾지 못했습니다.'].join('\n'),
          sources: file.excerpts.map((excerpt) => excerpt.source),
        })) },
      ],
      sources: [],
      note: '화살표는 코드에 적힌 파일 불러오기 관계입니다. 실제 실행·요청 순서와는 다를 수 있습니다. 경로 별칭과 실행 중에 정해지는 연결은 추측하지 않습니다.',
    });
  }

  if (scan.routes.length) {
    const rows = scan.routes.slice(0, 80).map((r) => [r.method, r.path, r.file]);
    system.push({
      id: 'api',
      title: '데이터를 주고받는 주소 (API)',
      blocks: [{ kind: 'table', head: ['방식', '경로', '파일'], rows }, ...(scan.routes.length > 80 ? [{ kind: 'text' as const, text: `외 ${scan.routes.length - 80}개` }] : [])],
      sources: scan.routes.slice(0, 40).map((route) => ({ kind: 'file', path: route.file, ...(route.line ? { startLine: route.line, endLine: route.line } : {}), ...(route.hash ? { hash: route.hash } : {}) })),
      note: '코드에 적힌 경로를 그대로 모았습니다. 라우터를 붙이는 앞쪽 경로(예: /api)는 포함되지 않을 수 있습니다.',
    });
  }

  const dataItems: RepoListItem[] = [];
  for (const d of allDeps.filter((x) => DATA_DEP.test(x))) dataItems.push({ text: DEP_LABEL[d] ?? d, detail: '데이터 저장' });
  for (const f of scan.files.filter((x) => /(^|\/)(schema\.prisma|.*\.sql|migrations\/)/.test(x.path)).slice(0, 8)) dataItems.push({ text: `\`${f.path}\``, detail: '데이터베이스 정의', sources: [fileSrc(f.path)] });
  for (const d of allDeps.filter((x) => EXTERNAL_DEP.test(x))) dataItems.push({ text: DEP_LABEL[d] ?? d, detail: '외부 서비스 호출' });
  if (scan.envExample?.keys.length) dataItems.push({ text: '환경 변수로 받는 설정', detail: scan.envExample.keys.slice(0, 8).join(', '), sources: [fileSrc(scan.envExample.path)] });
  if (scan.docker) dataItems.push({ text: 'Docker 설정이 있습니다', detail: 'Dockerfile 또는 compose 파일' });
  system.push({ id: 'data', title: '데이터와 외부 연동', blocks: dataItems.length ? [{ kind: 'list', items: dataItems }] : [{ kind: 'text', text: '데이터베이스나 외부 서비스 연동을 찾지 못했습니다 (파일로 저장하거나 메모리만 쓸 수 있음).' }], sources: [] });

  const testFiles = scan.files.filter((f) => /(^|\/)(test|tests|__tests__|e2e)\/|\.(test|spec)\.[jt]sx?$|(^|\/)test_.*\.py$/.test(f.path));
  const testRuns: RepoListItem[] = [];
  for (const s of sessions.slice(0, 10)) {
    const last = s.built.testsRun[s.built.testsRun.length - 1];
    if (last) testRuns.push({ text: `\`${truncate(last.command, 60)}\``, detail: last.failed ? '마지막 실행에 실패 표시 있음' : '실패 표시 없음', sources: [sessionSrc(s)] });
  }
  system.push({
    id: 'quality',
    title: '테스트와 검증',
    blocks: [
      { kind: 'text', text: testFiles.length ? `테스트 파일 ${testFiles.length}개 (${[...new Set(testFiles.map((f) => f.path.split('/').slice(0, 2).join('/')))].slice(0, 4).join(', ')} 등)` : '테스트 파일을 찾지 못했습니다.' },
      ...(testRuns.length ? [{ kind: 'list' as const, items: testRuns }] : []),
    ],
    sources: [],
    note: '세션에서 실행한 테스트 결과는 그 세션 기록에 남은 출력 기준입니다.',
  });

  const byCategory = new Map<string, RepoListItem[]>();
  for (const { f, s } of latestFinding.values()) {
    const list = byCategory.get(f.category) ?? [];
    list.push({ text: f.title, detail: f.checks[0], sources: [sessionSrc(s)] });
    byCategory.set(f.category, list);
  }
  const CAT: Record<string, string> = { security: '보안', data: '데이터', operation: '운영', change: '변경', verification: '검증' };
  system.push({
    id: 'risks',
    title: '주의할 동작',
    blocks: byCategory.size ? [...byCategory.entries()].map(([c, items]) => ({ kind: 'list' as const, items: items.map((i) => ({ ...i, text: `[${CAT[c] ?? c}] ${i.text}` })) })) : [{ kind: 'text', text: '세션 기록에서 찾은 주의 항목이 없습니다.' }],
    sources: [],
  });

  // ---------- 판·변경 ----------
  const facts: RepoFacts = {
    sessions: sessions.map((s) => s.key),
    features: features.map((f) => f.text),
    scripts: scriptRows.map((r) => r[0]!),
    routes: scan.routes.map((r) => `${r.method} ${r.path}`),
    dirs: [...top.keys()],
    deps: allDeps,
    findings: [...latestFinding.keys()],
  };
  const revision = `r_${shortId(`${REPO_WIKI_VERSION}|${scan.signature}|${sessions.map((s) => `${s.key}:${s.built.stats.toolCalls}`).join(',')}|${facts.features.join('|')}|${JSON.stringify(sessions.map((s) => ({ key: s.key, reviewed: s.securityReviewed === true, findings: s.findings })))}`, 12)}`;
  return {
    schemaVersion: 1,
    projectId: project.id,
    projectName: project.name,
    rootPath: project.rootPath,
    revision,
    builtAt: (input.now ?? new Date()).toISOString(),
    generator: { kind: 'rule', version: REPO_WIKI_VERSION },
    inputs: {
      sessions: sessions.map((s) => ({ key: s.key, title: s.title, ...(s.at ? { at: s.at } : {}), ...(s.mtime !== undefined ? { mtime: s.mtime } : {}) })),
      repo: { readable: scan.readable, fileCount: scan.files.length, truncated: scan.truncated, ...(scan.head ? { head: scan.head } : {}), ...(scan.branch ? { branch: scan.branch } : {}), signature: scan.signature },
    },
    user,
    system,
    changes: diffFacts(input.previous?.facts ?? null, facts, sessions),
    warnings,
    facts,
  };
}

/** 이전 판과 비교한 변경 요약 */
export function diffFacts(prev: RepoFacts | null, next: RepoFacts, sessions: RepoSessionDigest[]): string[] {
  if (!prev) return ['처음 만들었습니다.'];
  const out: string[] = [];
  const added = (a: string[], b: string[]) => b.filter((x) => !a.includes(x));
  const list = (xs: string[], max = 5) => `${xs.slice(0, max).join(', ')}${xs.length > max ? ` 외 ${xs.length - max}개` : ''}`;
  const newSessions = added(prev.sessions, next.sessions);
  if (newSessions.length) out.push(`새 세션 ${newSessions.length}개 반영: ${list(newSessions.map((k) => sessions.find((s) => s.key === k)?.title ?? k), 3)}`);
  const pairs: [keyof RepoFacts, string][] = [
    ['features', '기능'],
    ['scripts', '실행 명령'],
    ['routes', 'API 경로'],
    ['dirs', '최상위 폴더'],
    ['deps', '외부 프로그램'],
  ];
  for (const [k, label] of pairs) {
    const plus = added(prev[k], next[k]);
    const minus = added(next[k], prev[k]);
    if (plus.length) out.push(`${label} 추가: ${list(plus)}`);
    if (minus.length) out.push(`${label} 제거: ${list(minus)}`);
  }
  const newRisks = added(prev.findings, next.findings);
  const goneRisks = added(next.findings, prev.findings);
  if (newRisks.length) out.push(`새로 생긴 주의 항목 ${newRisks.length}개`);
  if (goneRisks.length) out.push(`최근 세션에서 더 이상 나오지 않는 주의 항목 ${goneRisks.length}개 (해결됐는지는 따로 확인 필요)`);
  if (!out.length) out.push('내용상 달라진 점이 없습니다.');
  return out;
}
