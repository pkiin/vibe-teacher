/**
 * Windows 배포 묶음을 만든다: npm run package [-- --config <공개 설정 파일>]
 *
 * release/vibe-teacher-<버전>-windows-x64.zip
 *   vibe-teacher/start.bat        두 번 눌러 실행
 *   vibe-teacher/README.txt       사용법
 *   vibe-teacher/runtime/node.exe 공식 Node 배포본 (SHASUMS256 확인)
 *   vibe-teacher/app/server.mjs   서버를 하나로 묶은 파일 (tsx 없이 실행)
 *   vibe-teacher/app/release.env  공개 설정 (.env.release 의 Supabase 주소·publishable 키)
 *   vibe-teacher/app/web/         빌드한 화면
 *
 * 장기 기억(mem0)·SQLite 네이티브 모듈은 넣지 않는다. 회원 모드는 원래 키워드 검색만 쓴다.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { NODE_VERSION, parseEnvText, releaseEnvText, windowsLauncher, windowsReadme } from './release-lib';
import { createZip, readZip, type ZipEntry } from './zip';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'release');
const NODE_DIST = `node-v${NODE_VERSION}-win-x64`;
const NODE_BASE = `https://nodejs.org/dist/v${NODE_VERSION}`;

function configPath(argv: string[]): string {
  const i = argv.indexOf('--config');
  if (i >= 0) {
    const value = argv[i + 1];
    if (!value) throw new Error('--config 다음에 공개 설정 파일 경로를 적으세요');
    return path.resolve(value);
  }
  return path.join(ROOT, '.env.release');
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`내려받지 못했습니다 (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** 공식 Node 배포본을 받아 SHASUMS256 과 대조한다. 한 번 받은 파일은 release/cache 에 둔다. */
async function nodeArchive(): Promise<Buffer> {
  const file = `${NODE_DIST}.zip`;
  const sums = (await download(`${NODE_BASE}/SHASUMS256.txt`)).toString('utf8');
  const expected = sums.split('\n').map((l) => l.trim().split(/\s+/)).find((p) => p[1] === file)?.[0];
  if (!expected) throw new Error(`SHASUMS256.txt 에 ${file} 이 없습니다`);
  const cached = path.join(OUT, 'cache', file);
  const sha = (data: Buffer): string => createHash('sha256').update(data).digest('hex');
  if (fs.existsSync(cached)) {
    const data = await fsp.readFile(cached);
    if (sha(data) === expected) return data;
  }
  console.log(`[package] ${file} 내려받는 중…`);
  const data = await download(`${NODE_BASE}/${file}`);
  if (sha(data) !== expected) throw new Error(`${file} 의 SHA256 이 공식 값과 다릅니다`);
  await fsp.mkdir(path.dirname(cached), { recursive: true });
  await fsp.writeFile(cached, data);
  return data;
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

async function main(): Promise<void> {
  const config = configPath(process.argv.slice(2));
  if (!fs.existsSync(config)) {
    throw new Error(`공개 설정 파일이 없습니다: ${config}\n  cp .env.release.example .env.release 후 SUPABASE_URL 과 SUPABASE_PUBLISHABLE_KEY 를 적으세요`);
  }
  const releaseEnv = releaseEnvText(parseEnvText(await fsp.readFile(config, 'utf8')));
  const version = (JSON.parse(await fsp.readFile(path.join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;

  console.log('[package] 화면 빌드 (npm -w web run build)');
  const web = spawnSync('npm', ['-w', 'web', 'run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (web.status !== 0) throw new Error('화면 빌드에 실패했습니다');

  const stage = path.join(OUT, 'build', 'windows-x64', 'vibe-teacher');
  await fsp.rm(path.dirname(stage), { recursive: true, force: true });
  const app = path.join(stage, 'app');
  await fsp.mkdir(app, { recursive: true });

  console.log('[package] 서버 묶기 (esbuild)');
  await build({
    entryPoints: [path.join(ROOT, 'server', 'src', 'index.ts')],
    outfile: path.join(app, 'server.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    // 회원 모드에서 쓰지 않는 장기 기억 SDK 와 네이티브 모듈은 넣지 않는다 (동적 import 라 실행 중 부르지 않음).
    external: ['mem0ai', 'mem0ai/*', 'better-sqlite3', 'pg-native'],
    // CommonJS 의존성(typescript 구문 분석기 등)이 require·__filename 을 쓰므로 ESM 묶음에 만들어 준다.
    banner: {
      js: [
        "import { createRequire as __vtCreateRequire } from 'node:module';",
        "import { fileURLToPath as __vtFileURLToPath } from 'node:url';",
        "import { dirname as __vtDirname } from 'node:path';",
        'const require = __vtCreateRequire(import.meta.url);',
        'const __filename = __vtFileURLToPath(import.meta.url);',
        'const __dirname = __vtDirname(__filename);',
      ].join(' '),
    },
    legalComments: 'external',
    tsconfig: path.join(ROOT, 'server', 'tsconfig.json'),
    logLevel: 'warning',
  });
  await fsp.cp(path.join(ROOT, 'web', 'dist'), path.join(app, 'web'), { recursive: true });
  await fsp.writeFile(path.join(app, 'release.env'), releaseEnv);

  console.log(`[package] Node ${NODE_VERSION} (win-x64) 확인`);
  const node = readZip(await nodeArchive());
  const runtime = path.join(stage, 'runtime');
  await fsp.mkdir(runtime, { recursive: true });
  for (const name of ['node.exe', 'LICENSE']) {
    const read = node.get(`${NODE_DIST}/${name}`);
    if (!read) throw new Error(`Node 배포본에 ${name} 이 없습니다`);
    await fsp.writeFile(path.join(runtime, name), read());
  }
  await fsp.writeFile(path.join(stage, 'start.bat'), windowsLauncher());
  await fsp.writeFile(path.join(stage, 'README.txt'), windowsReadme(version));

  const entries: ZipEntry[] = [];
  for (const rel of await listFiles(stage)) entries.push({ name: `vibe-teacher/${rel}`, data: await fsp.readFile(path.join(stage, ...rel.split('/'))) });
  const zip = createZip(entries);
  const target = path.join(OUT, `vibe-teacher-${version}-windows-x64.zip`);
  await fsp.writeFile(target, zip);
  console.log(`[package] ${path.relative(ROOT, target)} (${(zip.length / 1024 / 1024).toFixed(1)} MB, 파일 ${entries.length}개)`);
  console.log(`[package] SHA256 ${createHash('sha256').update(zip).digest('hex')}`);
  console.log('[package] 이 zip 에는 공개 설정만 들어 있습니다. 공개 저장소·게시판에 올리지 말고 참가자에게 직접 전달하세요.');
}

main().catch((err: Error) => {
  console.error(`[package] ${err.message}`);
  process.exit(1);
});
