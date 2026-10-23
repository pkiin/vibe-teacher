import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inspectRepo } from '../../src/repo/inspect';
import { scanRepo } from '../../src/repo/scan';
import { buildRepoWiki } from '../../src/repo/wiki';
import { LlmError, type LlmProvider, type LlmRequest } from '../../src/llm/types';

let root: string;
const SECRET = 'sk-test-abcdefghijklmnopqrstuvwxyz123456';
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-inspect-'));
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(root, 'src/service.ts'), `${'// 앞부분\n'.repeat(124)}export function load() { return ['목록']; }\nconst TOKEN = '${SECRET}';\n`);
  await fs.writeFile(path.join(root, '.env'), `TOKEN=${SECRET}`);
  await fs.symlink('/etc/passwd', path.join(root, 'link.txt'));
});
afterAll(() => fs.rm(root, { recursive: true, force: true }));
async function input() {
  const scan = await scanRepo(root);
  return { root, draft: buildRepoWiki({ project: { id: 'p', name: '앱', rootPath: root }, scan, sessions: [] }), files: scan.files.map((f) => f.path), level: 'non-dev' as const };
}
function provider(handler: (req: LlmRequest<unknown>) => unknown): LlmProvider {
  return { id: 'claude-cli', availability: async () => ({ ok: true }), complete: async <T,>(req: LlmRequest<T>) => ({ data: req.schema.parse(handler(req)), provider: 'claude-cli', durationMs: 1 }) };
}

describe('targeted repository questions', () => {
  it('reads only allowed requested slices, masks secrets, and carries verified source ranges into answers', async () => {
    const calls: LlmRequest<unknown>[] = [];
    const p = provider((req) => {
      calls.push(req);
      if (req.schemaName === 'repo_inspect_plan') return { questions: [
        { path: 'src/service.ts', line: 125, question: '목록을 어떻게 읽나요?' },
        { path: '.env', line: 1, question: '비밀값' },
        { path: '../outside.ts', line: 1, question: '범위 밖' },
        { path: 'link.txt', line: 1, question: '심볼릭 링크' },
      ] };
      const excerpts = JSON.parse(req.user) as { question: string; ref: string; code: string }[];
      expect(excerpts).toHaveLength(1);
      expect(excerpts[0]!.code).toContain('function load()');
      expect(excerpts[0]!.code).not.toContain(SECRET);
      expect(excerpts[0]!.ref).toBe('F:src/service.ts#L115-L127');
      return { answers: [
        { question: excerpts[0]!.question, answer: '목록을 반환합니다.', sources: [excerpts[0]!.ref] },
        { question: '추측', answer: '버려야 할 답변', sources: ['F:src/service.ts#L999-L1000'] },
      ] };
    });
    const result = await inspectRepo({ ...await input(), provider: p });
    expect(calls).toHaveLength(2);
    expect(calls.every((req) => req.task === 'repo-inspect' && req.system.includes('읽는 사람:'))).toBe(true);
    expect(calls[0]!.user).not.toContain(SECRET);
    expect(result.text).toContain('목록을 반환합니다.');
    expect(result.text).not.toContain('버려야 할 답변');
    expect(result.sources).toEqual([expect.objectContaining({ kind: 'file', path: 'src/service.ts', startLine: 115, endLine: 127 })]);
    expect(result.warnings).toHaveLength(1);
  });

  it('keeps the basic wiki path available if supplementary questions fail, but never swallows cancellation', async () => {
    const params = await input();
    const fail = provider(() => { throw new LlmError('network', '연결 실패'); });
    expect(await inspectRepo({ ...params, provider: fail })).toMatchObject({ text: '', sources: [], warnings: [expect.any(String)] });
    const cancel = provider(() => { throw new LlmError('cancelled', '취소'); });
    await expect(inspectRepo({ ...params, provider: cancel })).rejects.toMatchObject({ kind: 'cancelled' });
    const controller = new AbortController(); controller.abort();
    await expect(inspectRepo({ ...params, provider: fail, signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled' });
  });
});
