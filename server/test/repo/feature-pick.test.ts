import { describe, expect, it } from 'vitest';
import type { BuiltSummary, FileFact, TurnGroup } from '@vibe-teacher/shared';
import { LlmError, type LlmProvider, type LlmRequest } from '../../src/llm/types';
import { askRepoFeatures, buildFeaturePickUser, pickedFeaturesText, REPO_FEATURE_QUESTION } from '../../src/repo/feature-pick';
import type { RepoScan } from '../../src/repo/scan';
import { sessionMade, sessionMadeText, SESSION_MADE_LIMITS } from '../../src/repo/session-made';
import { buildRepoWiki } from '../../src/repo/wiki';

const SECRET = 'sk-live-THIS-MUST-NEVER-BE-SENT-1234567890';
const file = (relPath: string | undefined, count = 1, p = `/synthetic/app/${relPath}`): FileFact => ({ path: p, ...(relPath ? { relPath } : {}), via: 'tool', count, evidence: [] });
const turn = (i: number, promptText: string, finalAssistantText?: string): TurnGroup => ({ promptIndex: i, promptText, messageRange: [i, i], toolCallIds: [], filesTouched: [], ...(finalAssistantText ? { finalAssistantText } : {}) });
const built = (extra: Partial<BuiltSummary> = {}): BuiltSummary => ({
  filesCreated: [], filesModified: [], filesDeleted: [], dirsCreated: [], commandsRun: [], packagesInstalled: [], gitCommits: [], gitInitialized: false,
  testsRun: [], serversStarted: [], stack: [], timeline: [], stats: { humanMessages: 0, toolCalls: 0, errors: 0 }, ...extra,
});

describe('세션에서 만들어진 것 모으기', () => {
  it('내 말만 요청으로, 보고는 앞부분만, 파일은 작업 폴더 안 상대 경로만 많이 손댄 순으로 싣고 비밀값을 가린다', () => {
    const made = sessionMade({ key: 'k1', title: '메모 화면 만들기', endedAt: '2026-11-01T10:00:00Z' }, built({
      timeline: [
        turn(0, `메모 화면을 만들어 줘 <pasted_content id="x">붙여 넣은 로그 ${SECRET}</pasted_content>`, `메모 화면을 만들었습니다. 키는 ${SECRET} 입니다. ${'긴 보고 '.repeat(100)}`),
        turn(1, '<system-reminder>자동 문맥</system-reminder>'),
        ...Array.from({ length: 8 }, (_, i) => turn(i + 2, `고쳐 줘 ${i}`)),
      ],
      filesCreated: [file('web/src/Notes.tsx', 1)], filesModified: [file('server/src/notes.ts', 5), file(undefined, 9, '/home/someone/.bashrc'), file('../outside.ts', 3)],
      gitCommits: [{ message: '메모 화면 추가\n\n자세한 설명', evidence: [] }], packagesInstalled: [{ manager: 'npm', name: 'zod', evidence: [] }],
    }));
    expect(made.turns[0]!.request).toBe('메모 화면을 만들어 줘');
    expect(made.turns[0]!.report!.length).toBeLessThanOrEqual(SESSION_MADE_LIMITS.report);
    expect(JSON.stringify(made)).not.toContain(SECRET);
    // 자동 문맥만 있는 요청은 빼고, 처음 2개와 마지막 4개만 남긴다
    expect(made.turns.map((t) => t.request)).toEqual(['메모 화면을 만들어 줘', '고쳐 줘 0', '고쳐 줘 4', '고쳐 줘 5', '고쳐 줘 6', '고쳐 줘 7']);
    expect(made.files).toEqual(['server/src/notes.ts', 'web/src/Notes.tsx']);
    expect(made).toMatchObject({ commits: ['메모 화면 추가'], packages: ['zod'], at: '2026-11-01T10:00:00Z' });

    const other = sessionMade({ key: 'k2', title: '메모 고치기' }, built({ filesModified: [file('server/src/notes.ts')] }));
    const text = sessionMadeText([made, other], new Map([['k1', 'S1']]));
    expect(text.split('\n')[0]).toBe('여러 세션에서 만들고 고친 파일: server/src/notes.ts(2)');
    expect(text).toContain('S1 · 메모 화면 만들기 · 2026-11-01');
    expect(text).toContain('(세션) · 메모 고치기');
    expect(text).toContain('  커밋: 메모 화면 추가');
    const many = sessionMadeText(Array.from({ length: 200 }, (_, i) => ({ ...made, key: `k${i}` })), new Map());
    expect(many.length).toBeLessThanOrEqual(SESSION_MADE_LIMITS.promptChars + 200);
    expect(many).toMatch(/글자 수 상한으로 세션 \d+개는 생략/);
  });
});

describe('주요 기능 따로 묻기', () => {
  const scan: RepoScan = { root: '/synthetic', readable: 'ok', scannedAt: '', signature: 's', files: ['web/src/Notes.tsx', 'server/src/notes.ts', 'server/src/auth.ts'].map((p) => ({ path: p, size: 1 })), truncated: false,
    packages: [{ path: 'package.json', scripts: { dev: 'vite' }, dependencies: [], devDependencies: [], workspaces: [] }], docker: false, routes: [{ method: 'GET', path: '/api/notes', file: 'server/src/notes.ts' }],
    readme: { path: 'README.md', text: '메모 앱' } };
  const draft = buildRepoWiki({ project: { id: 'p', name: '메모', rootPath: '/synthetic' }, scan, sessions: [] });

  it('질문과 README·경로·세션에서 만들어진 것·파일 목록을 보내고, 고른 기능은 본문 입력의 정해진 목록이 된다', async () => {
    const made = [sessionMade({ key: 'k1', title: '메모 화면' }, built({ filesCreated: [file('web/src/Notes.tsx')] }))];
    const user = buildFeaturePickUser({ draft, scan, made, handles: new Map([['k1', 'S1']]) });
    expect(user.split('\n')[0]).toBe(`질문: ${REPO_FEATURE_QUESTION}`);
    for (const part of ['=== README F:README.md', 'GET /api/notes → F:server/src/notes.ts', 'S1 · 메모 화면', '만들고 고친 파일: web/src/Notes.tsx', 'F:server/src/auth.ts', 'dev: vite']) expect(user).toContain(part);

    const requests: LlmRequest<unknown>[] = [];
    const provider: LlmProvider = { id: 'claude-cli', availability: async () => ({ ok: true }), complete: async (req) => {
      requests.push(req as LlmRequest<unknown>);
      return { data: req.schema.parse({ answer: '메모를 쓰고 보는 앱입니다.', features: [{ id: 'notes', name: '메모', summary: '메모를 씁니다.', files: ['F:web/src/Notes.tsx'], sessions: ['S1'], sources: ['S1'] }],
        foundations: [{ name: '로그인', summary: '사용자를 확인합니다.', files: ['F:server/src/auth.ts'] }] }), provider: 'claude-cli', durationMs: 5, costUsd: 0.01 };
    } };
    const picked = await askRepoFeatures({ user, extra: `=== 기존 주요 기능 id ===\n${SECRET}`, provider, level: 'non-dev', timeoutMs: 1000 });
    expect(requests[0]).toMatchObject({ schemaName: 'repo_wiki_features' });
    expect(requests[0]!.task).toBeUndefined();
    expect(requests[0]!.system).toContain('읽는 사람:');
    expect(requests[0]!.user).not.toContain(SECRET);
    expect(picked).toMatchObject({ warnings: [], durationMs: 5, costUsd: 0.01 });
    const text = pickedFeaturesText(picked.output!);
    expect(text).toContain('=== 정해진 주요 기능');
    expect(text).toContain('"id":"notes"');
    expect(text).toContain('=== 공통 기반');
  });

  it('기능을 고르지 않거나 실패하면 경고를 남기고 본문 작성에서 고르게 하며, 취소는 그대로 전한다', async () => {
    const reply = (data: unknown): LlmProvider => ({ id: 'claude-cli', availability: async () => ({ ok: true }), complete: async (req) => ({ data: req.schema.parse(data), provider: 'claude-cli', durationMs: 1 }) });
    const fail = (err: Error): LlmProvider => ({ id: 'claude-cli', availability: async () => ({ ok: true }), complete: async () => { throw err; } });
    expect(await askRepoFeatures({ user: 'x', provider: reply({ answer: '', features: [], foundations: [] }), level: 'non-dev', timeoutMs: 1 })).toMatchObject({ output: null, warnings: ['AI가 주요 기능을 고르지 않아 본문 작성에서 함께 골랐습니다.'] });
    expect((await askRepoFeatures({ user: 'x', provider: fail(new Error('CLI 실패')), level: 'non-dev', timeoutMs: 1 })).warnings).toEqual(['주요 기능을 따로 묻지 못해 본문 작성에서 함께 골랐습니다: CLI 실패']);
    await expect(askRepoFeatures({ user: 'x', provider: fail(new LlmError('cancelled', '취소')), level: 'non-dev', timeoutMs: 1 })).rejects.toThrow('취소');
  });
});
