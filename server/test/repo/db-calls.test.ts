import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findModuleCalls, namedFunctions, reachableNames } from '../../src/repo/db-calls';
import { scanRepo } from '../../src/repo/scan';
import { readRepoText } from '../../src/repo/source';

const temps: string[] = [];
afterEach(async () => { await Promise.all(temps.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))); });

/** 공용 저장 클래스: private 도우미가 표를 쓰고 공개 메서드가 그 도우미를 부른다 */
const STORE = `export class Store {
  private async fetchDocs(keys: string[]) {
    const key = this.key(keys[0]);
    return this.client.call('/rest/v1/docs?' + key);
  }
  private key(k: string) { return k; }
  async readDoc(file: string) {
    queueMicrotask(() => void this.fetchDocs([file]));
    return this.readDoc2(file);
  }
  readDoc2(file: string) { return file; }
  async list() { return this.fetchDocs([]); }
}
`;

describe('공용 모듈을 거쳐 표를 쓰는 기능 코드 찾기', () => {
  it('표를 쓰는 private 도우미에서 같은 파일의 공개 메서드까지 따라가고, 흔한 이름은 빼며, 다른 파일에서 부르는 줄을 파일마다 하나씩 모은다', () => {
    const fns = namedFunctions('src/store.ts', STORE);
    expect(fns.find((f) => f.name === 'fetchDocs')).toMatchObject({ start: 2, end: 5, isPrivate: true });
    // 이름 없는 화살표 함수 안의 호출은 바깥 메서드의 호출로 본다
    expect(fns.find((f) => f.name === 'readDoc')?.calls.has('fetchDocs')).toBe(true);
    expect([...reachableNames(fns, [4]).methods]).toEqual(['readDoc']);

    const files = [
      { path: 'src/store.ts', hash: 'a', text: STORE },
      { path: 'src/notes.ts', hash: 'b', text: "export async function show(storage: Store) {\n  return storage.readDoc('a');\n}\nconst again = () => storage.readDoc('b');\n" },
      { path: 'src/self.ts', hash: 'c', text: 'class X { readDoc() { return this.readDoc(); } }\n' },
      { path: 'src/other.ts', hash: 'd', text: "// storage.readDoc('주석')\nimport { readDoc } from './store';\nawait store.list();\n" },
      { path: 'db/schema.ts', hash: 'e', text: "storage.readDoc('정의 파일')\n" },
    ];
    const direct = new Map([['docs', [{ line: 4, path: 'src/store.ts', text: "this.client.call('/rest/v1/docs')" }]]]);
    const calls = findModuleCalls(direct, files, new Map(), () => new Set(['db/schema.ts']));
    expect(calls.get('docs')).toEqual([{ line: 2, path: 'src/notes.ts', text: "return storage.readDoc('a');", via: 'readDoc', through: 'src/store.ts' }]);
  });

  it('불러온 모듈의 내보낸 함수는 이름만으로 부르는 줄도 찾되, 정의 줄은 빼고 불러오지 않은 파일은 보지 않는다', () => {
    const module = { path: 'src/db.ts', hash: 'a', text: "export function saveNote(n: string) {\n  return sql`insert into notes values (${n})`;\n}\n" };
    const page = { path: 'src/page.ts', hash: 'b', text: "import { saveNote } from './db';\nfunction saveNote2() {}\nexport const onSave = () => saveNote('x');\n" };
    const stranger = { path: 'src/stranger.ts', hash: 'c', text: "saveNote('다른 모듈');\n" };
    const calls = findModuleCalls(new Map([['notes', [{ line: 2, path: 'src/db.ts', text: 'insert into notes' }]]]), [module, page, stranger], new Map([['src/page.ts', ['src/db.ts']]]), () => new Set());
    expect(calls.get('notes')).toEqual([expect.objectContaining({ path: 'src/page.ts', line: 3, via: 'saveNote', through: 'src/db.ts' })]);
  });

  it('비밀값 마스킹이 코드를 가려도 원문으로 만든 함수 윤곽으로 따라가고, 원문은 내보내지 않는다', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-db-calls-')); temps.push(root);
    const write = async (rel: string, text: string) => { await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true }); await fs.writeFile(path.join(root, rel), text); };
    await write('db/schema.sql', 'create table docs (\n  id int primary key,\n  body text\n);\n');
    // `const key = …` `token = …` 은 마스킹되어 구문이 깨진다
    await write('src/store.ts', "export class Store {\n  private async fetchDocs(file: string) {\n    const key = this.pathKey(file).split('/').join(':');\n    const token = randomUUID();\n    return this.client.call(`/rest/v1/docs?key=${key}`);\n  }\n  async readDoc(file: string) { return this.fetchDocs(file); }\n}\n");
    await write('src/notes.ts', "export const show = (storage: Store) => storage.readDoc('a');\n");
    const read = await readRepoText(root, 'src/store.ts', { functions: true });
    expect(read!.text).toContain('***');
    expect(read!.functions?.find((f) => f.name === 'fetchDocs')).toMatchObject({ start: 2, end: 6 });
    expect(Object.keys(read!)).not.toContain('raw');
    const scan = await scanRepo(root);
    const docs = scan.database!.tables.find((t) => t.name === 'docs')!;
    expect(docs.usages.map((u) => `${u.path}:${u.startLine}`)).toEqual(['src/store.ts:5', 'src/notes.ts:1']);
    expect(scan.database!.hints[docs.id]!.usages[1]).toContain('(공용 코드 src/store.ts의 readDoc를 부름. 그 함수가 이 표를 씀)');
  });
});
