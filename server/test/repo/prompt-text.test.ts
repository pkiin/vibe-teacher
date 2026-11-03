import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RepoFeaturePage, RepoFeaturePromptPart } from '@vibe-teacher/shared';
import { withPromptText } from '../../src/repo/feature';
import { extractPrompts } from '../../src/repo/prompt-text';
import { readRepoText } from '../../src/repo/source';

const temps: string[] = [];
afterEach(async () => { await Promise.all(temps.splice(0).map((d) => fs.rm(d, { recursive: true, force: true }))); });

/** 조각을 화면처럼 이어 본다: 실행 중 값은 {식} */
const show = (parts: RepoFeaturePromptPart[]) => parts.map((p) => p.segments.map((s) => (s.kind === 'slot' ? `{${s.text}}` : s.text)).join(''));

/** 합성 코드. 줄 번호를 검사에 쓴다. */
const TS = [
  "import OpenAI from 'openai';",                                                       // 1
  "import { GUIDE } from './guide';",                                                    // 2
  'export const SYSTEM = `당신은 요약가입니다.',                                          // 3
  '짧게 요약하세요.`;',                                                                   // 4
  'export function buildUser(text: string, lang: string) {',                              // 5
  "  return '다음 글을 ' + lang + '로 요약: ' + text;",                                   // 6
  '}',                                                                                     // 7
  'function withGuide(prompt: string) { return `${prompt}\\n\\n${GUIDE}`; }',             // 8
  'export async function run(text: string) {',                                             // 9
  "  if (!text) throw new Error('요약할 글이 없습니다');",                                // 10
  "  const res = await client.chat({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: withGuide(SYSTEM) }, { role: 'user', content: buildUser(text, 'ko') }] });", // 11
  "  return { preview: true, system: SYSTEM, user: '미리 보기 문장입니다' };",            // 12
  '}',                                                                                     // 13
  'export async function translate(text: string) {',                                       // 14
  "  return provider.complete({ schemaName: 'translate', system: '번역가입니다. 뜻을 지키세요.', user: JSON.stringify({ text }) });", // 15
  '}',                                                                                     // 16
].join('\n');
const GUIDE = "export const GUIDE = '규칙: 사실만 짧게 씁니다.';\n";

const read = async (file: string) => (file === 'src/guide.ts' ? GUIDE : null);

describe('실제로 AI 에 가는 프롬프트 꺼내기 (JS·TS)', () => {
  it('요청의 역할별 값을 따라가 상수·불러온 파일·감싸는 함수의 실제 인자를 펼친다', async () => {
    const system = await extractPrompts({ file: 'src/app.ts', code: TS, range: { start: 9, end: 13 }, role: 'system', read });
    expect(show(system)).toEqual(['당신은 요약가입니다.\n짧게 요약하세요.\n\n규칙: 사실만 짧게 씁니다.']);
    expect(system[0]).toMatchObject({ line: 11, call: 'client.chat · gpt-4o-mini', from: expect.arrayContaining([{ path: 'src/app.ts', line: 3 }, { path: 'src/guide.ts', line: 1 }]) });
    // 함수의 매개변수에는 부른 쪽 인자를 넣고, 실행 중 값은 그대로 둔다. 미리 보기 응답 객체는 요청이 아니므로 뺀다
    expect(show(await extractPrompts({ file: 'src/app.ts', code: TS, range: { start: 9, end: 13 }, role: 'user', read }))).toEqual(['다음 글을 ko로 요약: {text}']);
  });

  it('고정 문장이 없는 값은 식 그대로 실행 중 값으로 보이고, 한 범위의 여러 요청은 호출별로 구분한다', async () => {
    const user = await extractPrompts({ file: 'src/app.ts', code: TS, range: { start: 14, end: 16 }, role: 'user' });
    expect(user).toMatchObject([{ line: 15, call: 'provider.complete · translate', segments: [{ kind: 'slot', text: 'JSON.stringify({ text })' }] }]);
    const both = await extractPrompts({ file: 'src/app.ts', code: TS, range: { start: 9, end: 16 }, role: 'system', read });
    expect(both.map((p) => p.call)).toEqual(['client.chat · gpt-4o-mini', 'provider.complete · translate']);
  });

  it('역할 키가 없으면 범위 안 문장이 하나일 때만 쓰고 오류 문구·모듈 경로·키는 프롬프트로 보지 않는다', async () => {
    expect(show(await extractPrompts({ file: 'src/app.ts', code: TS, range: { start: 3, end: 3 }, role: 'system' }))).toEqual(['당신은 요약가입니다.\n짧게 요약하세요.']);
    expect(await extractPrompts({ file: 'src/app.ts', code: TS, range: { start: 10, end: 10 }, role: 'system' })).toEqual([]);
    expect(await extractPrompts({ file: 'src/app.ts', code: TS, range: { start: 1, end: 2 }, role: 'system' })).toEqual([]);
    expect(await extractPrompts({ file: 'src/app.ts', code: TS, range: { start: 3, end: 7 }, role: 'system' })).toEqual([]);
  });

  it('발췌만 있으면 줄 번호를 파일 기준으로 맞춘다', async () => {
    const slice = TS.split('\n').slice(13, 16).join('\n');
    expect(await extractPrompts({ file: 'src/app.ts', code: slice, range: { start: 14, end: 16 }, role: 'system', lineOffset: 13 })).toMatchObject([{ line: 15, segments: [{ kind: 'text', text: '번역가입니다. 뜻을 지키세요.' }] }]);
  });
});

const PY = [
  'import openai',                                                                         // 1
  'SYSTEM = """',                                                                         // 2
  '당신은 번역가입니다.',                                                                  // 3
  '원문 뜻을 지키세요."""',                                                                // 4
  'def call(text, lang):',                                                                 // 5
  '    # "role": "system" 이라고 적힌 주석은 요청이 아닙니다',                             // 6
  '    return openai.chat(model="gpt-4o", messages=[{"role": "system", "content": SYSTEM},', // 7
  '        {"role": "user", "content": f"{lang}로 번역: {text} (괄호 {{원문}})"}])',        // 8
  'def other():',                                                                          // 9
  '    return client.messages.create(system=SYSTEM, max_tokens=10)',                       // 10
].join('\n');

describe('실제로 AI 에 가는 프롬프트 꺼내기 (Python)', () => {
  it('메시지 역할·키워드 인자를 따라가 상수와 f-string 의 실행 중 값을 구분한다', async () => {
    expect(await extractPrompts({ file: 'a.py', code: PY, range: { start: 5, end: 8 }, role: 'system' })).toMatchObject([{ line: 7, from: [{ path: 'a.py', line: 2 }], segments: [{ kind: 'text', text: '당신은 번역가입니다.\n원문 뜻을 지키세요.' }] }]);
    expect(show(await extractPrompts({ file: 'a.py', code: PY, range: { start: 5, end: 8 }, role: 'user' }))).toEqual(['{lang}로 번역: {text} (괄호 {원문})']);
    expect(show(await extractPrompts({ file: 'a.py', code: PY, range: { start: 10, end: 10 }, role: 'system' }))).toEqual(['당신은 번역가입니다.\n원문 뜻을 지키세요.']);
    expect(await extractPrompts({ file: 'a.md', code: '# 제목', range: { start: 1, end: 1 }, role: 'system' })).toEqual([]);
  });
});

describe('저장한 기능 페이지 읽기', () => {
  it('파일이 분석 때와 같으면 파일 전체로 따라가고, 바뀌었으면 저장한 줄만으로 꺼낸다', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-prompt-')); temps.push(root);
    await fs.mkdir(path.join(root, 'src'));
    await fs.writeFile(path.join(root, 'src', 'app.ts'), TS);
    await fs.writeFile(path.join(root, 'src', 'guide.ts'), GUIDE);
    const file = (await readRepoText(root, 'src/app.ts'))!;
    const line11 = TS.split('\n')[10]!;
    const page = { aiCalls: [{ purpose: '요약', provider: 'SDK', modelOrigin: 'unknown', outputHandling: '', sources: [],
      systemPrompt: { source: { kind: 'file', path: 'src/app.ts', startLine: 11, endLine: 11, hash: file.hash }, text: line11 } }] } as unknown as RepoFeaturePage;
    const filled = (await withPromptText(root, page)).aiCalls[0]!.systemPrompt!;
    expect(show(filled.prompts!)).toEqual(['당신은 요약가입니다.\n짧게 요약하세요.\n\n규칙: 사실만 짧게 씁니다.']);
    expect(filled.text).toBe(line11);
    await fs.writeFile(path.join(root, 'src', 'app.ts'), `// 바뀜\n${TS}`);
    const stale = (await withPromptText(root, page)).aiCalls[0]!.systemPrompt!;
    // 바뀐 파일은 다시 읽지 않는다: 저장한 한 줄에서는 상수 내용을 알 수 없어 식을 실행 중 값으로 보여 준다
    expect(show(stale.prompts!)).toEqual(['{withGuide(SYSTEM)}']);
  });
});
