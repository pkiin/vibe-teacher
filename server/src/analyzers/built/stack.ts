import path from 'node:path';
import type { CommandFact, Evidence, FileFact, PackageFact, StackFact } from '@vibe-teacher/shared';

type Kind = StackFact['kind'];
const stackDefs: Record<string, { name: string; kind: Kind }> = {
  typescript: { name: 'TypeScript', kind: 'language' },
  javascript: { name: 'JavaScript', kind: 'language' },
  python: { name: 'Python', kind: 'language' },
  html: { name: 'HTML', kind: 'language' },
  css: { name: 'CSS', kind: 'language' },
  sql: { name: 'SQL', kind: 'language' },
  shell: { name: '셸 스크립트', kind: 'language' },
  markdown: { name: 'Markdown', kind: 'language' },
  go: { name: 'Go', kind: 'language' },
  rust: { name: 'Rust', kind: 'language' },
  react: { name: 'React', kind: 'framework' },
  vite: { name: 'Vite', kind: 'tool' },
  next: { name: 'Next.js', kind: 'framework' },
  vue: { name: 'Vue', kind: 'framework' },
  svelte: { name: 'Svelte', kind: 'framework' },
  express: { name: 'Express', kind: 'framework' },
  hono: { name: 'Hono', kind: 'framework' },
  fastapi: { name: 'FastAPI', kind: 'framework' },
  flask: { name: 'Flask', kind: 'framework' },
  django: { name: 'Django', kind: 'framework' },
  tailwind: { name: 'Tailwind CSS', kind: 'framework' },
  supabase: { name: 'Supabase', kind: 'service' },
  firebase: { name: 'Firebase', kind: 'service' },
  prisma: { name: 'Prisma', kind: 'tool' },
  drizzle: { name: 'Drizzle ORM', kind: 'tool' },
  sqlite: { name: 'SQLite', kind: 'service' },
  postgres: { name: 'PostgreSQL', kind: 'service' },
  vitest: { name: 'Vitest', kind: 'tool' },
  jest: { name: 'Jest', kind: 'tool' },
  playwright: { name: 'Playwright', kind: 'tool' },
  pytest: { name: 'pytest', kind: 'tool' },
  zod: { name: 'Zod', kind: 'tool' },
  axios: { name: 'Axios', kind: 'tool' },
  docker: { name: 'Docker', kind: 'tool' },
  git: { name: 'Git', kind: 'tool' },
  github: { name: 'GitHub (gh CLI)', kind: 'service' },
  npm: { name: 'npm', kind: 'tool' },
  bun: { name: 'Bun', kind: 'tool' },
  pnpm: { name: 'pnpm', kind: 'tool' },
  uv: { name: 'uv', kind: 'tool' },
  pip: { name: 'pip', kind: 'tool' },
  vercel: { name: 'Vercel', kind: 'service' },
  netlify: { name: 'Netlify', kind: 'service' },
  cloudflare: { name: 'Cloudflare Workers', kind: 'service' },
  openai: { name: 'OpenAI API', kind: 'service' },
  anthropic: { name: 'Anthropic API', kind: 'service' },
  dotenv: { name: '환경 변수(.env)', kind: 'tool' },
  eslint: { name: 'ESLint', kind: 'tool' },
  prettier: { name: 'Prettier', kind: 'tool' },
};

const EXT_TO_STACK: Record<string, string[]> = {
  '.ts': ['typescript'],
  '.tsx': ['typescript', 'react'],
  '.js': ['javascript'],
  '.mjs': ['javascript'],
  '.cjs': ['javascript'],
  '.jsx': ['javascript', 'react'],
  '.py': ['python'],
  '.html': ['html'],
  '.css': ['css'],
  '.scss': ['css'],
  '.sql': ['sql'],
  '.sh': ['shell'],
  '.md': ['markdown'],
  '.go': ['go'],
  '.rs': ['rust'],
  '.vue': ['vue'],
  '.svelte': ['svelte'],
};

const FILE_TO_STACK: [RegExp, string[]][] = [
  [/^package\.json$/, ['npm']],
  [/^tsconfig.*\.json$/, ['typescript']],
  [/^vite\.config\./, ['vite']],
  [/^next\.config\./, ['next']],
  [/^tailwind\.config\./, ['tailwind']],
  [/^\.env(\..*)?$/, ['dotenv']],
  [/^requirements\.txt$/, ['pip', 'python']],
  [/^pyproject\.toml$/, ['python']],
  [/^uv\.lock$/, ['uv']],
  [/^Dockerfile$/, ['docker']],
  [/^docker-compose\.ya?ml$/, ['docker']],
  [/^bun\.lockb?$/, ['bun']],
  [/^pnpm-lock\.yaml$/, ['pnpm']],
  [/^\.eslintrc|^eslint\.config\./, ['eslint']],
  [/^\.prettierrc/, ['prettier']],
  [/^wrangler\.(toml|json)$/, ['cloudflare']],
  [/^vercel\.json$/, ['vercel']],
  [/^netlify\.toml$/, ['netlify']],
  [/^supabase$/, ['supabase']],
];

const PKG_TO_STACK: [RegExp, string][] = [
  [/^react(-dom)?$/, 'react'],
  [/^vite$/, 'vite'],
  [/^next$/, 'next'],
  [/^vue$/, 'vue'],
  [/^svelte$/, 'svelte'],
  [/^express$/, 'express'],
  [/^hono$/, 'hono'],
  [/^fastapi$/, 'fastapi'],
  [/^flask$/, 'flask'],
  [/^django$/, 'django'],
  [/^tailwindcss$/, 'tailwind'],
  [/^@supabase\//, 'supabase'],
  [/^firebase/, 'firebase'],
  [/^prisma$|^@prisma\//, 'prisma'],
  [/^drizzle-orm$/, 'drizzle'],
  [/^better-sqlite3$|^sqlite3$/, 'sqlite'],
  [/^pg$|^postgres$|^psycopg/, 'postgres'],
  [/^vitest$/, 'vitest'],
  [/^jest$/, 'jest'],
  [/^@playwright\/test$|^playwright$/, 'playwright'],
  [/^pytest$/, 'pytest'],
  [/^zod$/, 'zod'],
  [/^axios$/, 'axios'],
  [/^openai$/, 'openai'],
  [/^@anthropic-ai\/|^anthropic$/, 'anthropic'],
  [/^dotenv$|^python-dotenv$/, 'dotenv'],
  [/^typescript$/, 'typescript'],
  [/^eslint$/, 'eslint'],
  [/^prettier$/, 'prettier'],
];

const CMD_TO_STACK: [RegExp, string][] = [
  [/^git\b/, 'git'],
  [/^gh\b/, 'github'],
  [/^docker\b|^docker-compose\b/, 'docker'],
  [/^(npm|npx)\b/, 'npm'],
  [/^(bun|bunx)\b/, 'bun'],
  [/^pnpm\b/, 'pnpm'],
  [/^uv\b/, 'uv'],
  [/^pip3?\b/, 'pip'],
  [/^python3?\b/, 'python'],
  [/^vercel\b/, 'vercel'],
  [/^netlify\b/, 'netlify'],
  [/^wrangler\b/, 'cloudflare'],
  [/^supabase\b/, 'supabase'],
  [/^(npx |bunx )?vite\b/, 'vite'],
  [/^(npx )?tsc\b/, 'typescript'],
  [/^(npx )?vitest\b/, 'vitest'],
  [/^pytest\b/, 'pytest'],
];

export function collectStack(files: FileFact[], packages: PackageFact[], commands: CommandFact[]): StackFact[] {
  const hits = new Map<string, Evidence[]>();
  const add = (id: string, e: Evidence) => {
    if (!stackDefs[id]) return;
    const list = hits.get(id) ?? [];
    if (list.length < 4 && !list.some((x) => x.snippet === e.snippet)) list.push(e);
    hits.set(id, list);
  };
  for (const f of files) {
    const base = path.basename(f.path);
    const e: Evidence = { snippet: f.relPath ?? f.path };
    for (const id of EXT_TO_STACK[path.extname(base).toLowerCase()] ?? []) add(id, e);
    for (const [re, ids] of FILE_TO_STACK) if (re.test(base)) for (const id of ids) add(id, e);
  }
  for (const p of packages) {
    for (const [re, id] of PKG_TO_STACK) if (re.test(p.name)) add(id, { snippet: `${p.manager}: ${p.name}` });
  }
  for (const c of commands) {
    for (const [re, id] of CMD_TO_STACK) if (re.test(c.command)) add(id, { snippet: c.command });
  }
  const order: Kind[] = ['language', 'framework', 'tool', 'service'];
  return Array.from(hits.entries())
    .map(([id, evidence]) => ({ id, name: stackDefs[id]?.name ?? id, kind: stackDefs[id]?.kind ?? 'tool', evidence }))
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.name.localeCompare(b.name));
}
