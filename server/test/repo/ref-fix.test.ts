import { describe, expect, it } from 'vitest';
import { LlmError, type LlmProvider, type LlmRequest } from '../../src/llm/types';
import { askRepoRefFixes } from '../../src/repo/ref-fix';

const SECRET = 'sk-live-THIS-MUST-NEVER-BE-SENT-1234567890';
const fake = (reply: (req: LlmRequest<unknown>) => unknown) => {
  const requests: LlmRequest<unknown>[] = [];
  const provider: LlmProvider = { id: 'claude-cli', availability: async () => ({ ok: true }), complete: async (req) => {
    requests.push(req as LlmRequest<unknown>);
    return { data: req.schema.parse(reply(req as LlmRequest<unknown>)), provider: 'claude-cli', model: 'fixture', durationMs: 4, costUsd: 0.002 };
  } };
  return { provider, requests };
};
const problems = [
  { ref: 'F:src/a.ts#L1-L40', problem: '보낸 발췌 밖의 줄이 들어 있습니다', usedIn: [`기능 목록: ${SECRET}`], candidates: ['F:src/a.ts#L1-L1', 'F:src/a.ts#L40-L40', 'F:src/a.ts'] },
  { ref: 'F:src/ghost.ts', problem: '제공된 파일 목록에 없는 파일입니다', usedIn: ['기능 유령'], candidates: [] },
];

describe('확인하지 못한 근거 표시 다시 묻기', () => {
  it('후보가 있는 표시만 묻고, 후보 밖의 답은 버린다', async () => {
    const { provider, requests } = fake(() => ({ fixes: [
      { ref: 'F:src/a.ts#L1-L40', replacements: ['F:src/a.ts#L1-L1', 'F:src/a.ts#L1-L40', 'F:src/b.ts', 'F:src/a.ts#L40-L40'] },
      { ref: 'F:src/ghost.ts', replacements: ['F:src/a.ts'] },
      { ref: 'F:src/a.ts#L1-L40', replacements: ['F:src/a.ts'] },
    ] }));
    const res = await askRepoRefFixes({ problems, provider });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ task: 'repo-inspect', schemaName: 'repo_wiki_refs' });
    expect(requests[0]!.user).not.toContain(SECRET);
    expect((JSON.parse(requests[0]!.user) as { refs: { ref: string }[] }).refs.map((r) => r.ref)).toEqual(['F:src/a.ts#L1-L40']);
    expect([...res.fixes]).toEqual([['F:src/a.ts#L1-L40', ['F:src/a.ts#L1-L1', 'F:src/a.ts#L40-L40']]]);
    expect(res).toMatchObject({ asked: 1, warnings: [], durationMs: 4, costUsd: 0.002 });
  });

  it('물을 것이 없으면 부르지 않고, 실패하면 경고만 남기며, 취소는 그대로 전한다', async () => {
    const idle = fake(() => ({ fixes: [] }));
    expect((await askRepoRefFixes({ problems: [problems[1]!], provider: idle.provider })).asked).toBe(0);
    expect(idle.requests).toHaveLength(0);
    const failed = await askRepoRefFixes({ problems, provider: fake(() => { throw new Error('CLI 실패'); }).provider });
    expect(failed.fixes.size).toBe(0);
    expect(failed.warnings).toEqual(['확인하지 못한 근거 표시를 AI에 다시 묻지 못했습니다: CLI 실패']);
    await expect(askRepoRefFixes({ problems, provider: fake(() => { throw new LlmError('cancelled', '취소'); }).provider })).rejects.toThrow('취소');
  });
});
