import fsp from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, pathExists, readJsonSafe, writeJsonAtomic } from '../lib/fsx';
import { readJsonl } from '../lib/jsonl';

/**
 * 위키·개인 상태의 durable 저장소. VIBE_TEACHER_HOME/wiki 아래에만 쓴다 (스캔 대상 홈에는 쓰지 않음).
 *   projects/<projectId>/...                         프로젝트 평면 (snapshot, 세션별 이력)
 *   learners/<learnerId>/projects/<projectId>/...    개인 평면 (이벤트 원장, 파생 프로필)
 * 같은 키의 쓰기는 KeyedMutex 로 직렬화한다 (서버 프로세스 하나 기준).
 */

const SEGMENT = /^[A-Za-z0-9_-]{1,80}$/;

/** 경로 조각으로 쓸 ID 검사. ../ 같은 값으로 저장소 밖에 쓰지 못하게 한다. */
export function safeSegment(value: string, what: string): string {
  if (!SEGMENT.test(value)) throw new Error(`경로에 쓸 수 없는 ${what}: ${JSON.stringify(value).slice(0, 40)}`);
  return value;
}

/** 키별 비동기 직렬화. 같은 키의 작업은 들어온 순서대로 하나씩 실행된다. */
export class KeyedMutex {
  private tails = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const tail = prev.then(() => gate);
    this.tails.set(key, tail);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

export class WikiStorage {
  readonly root: string;
  private readonly mutex = new KeyedMutex();

  constructor(home: string, private readonly projectIds: (id: string) => string[] = (id) => [id]) {
    this.root = path.join(home, 'wiki');
  }

  projectDir(projectId: string): string {
    return path.join(this.root, 'projects', safeSegment(projectId, '프로젝트 ID'));
  }

  learnerDir(learnerId: string): string {
    return path.join(this.root, 'learners', safeSegment(learnerId, '학습자 ID'));
  }

  learnerProjectDir(learnerId: string, projectId: string): string {
    return path.join(this.root, 'learners', safeSegment(learnerId, '학습자 ID'), 'projects', safeSegment(projectId, '프로젝트 ID'));
  }

  lock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return this.mutex.run(key, fn);
  }

  /** 예전 프로젝트 폴더는 옮기거나 덮어쓰지 않고 함께 읽는다. 새 쓰기는 대표 ID로 한다. */
  projectFiles(projectId: string, ...parts: string[]): string[] {
    return this.projectIds(projectId).map((id) => path.join(this.projectDir(id), ...parts));
  }

  learnerProjectFiles(learnerId: string, projectId: string, ...parts: string[]): string[] {
    return this.projectIds(projectId).map((id) => path.join(this.learnerProjectDir(learnerId, id), ...parts));
  }

  readJson<T>(file: string): Promise<T | null> {
    return readJsonSafe<T>(file);
  }

  writeJson(file: string, value: unknown): Promise<void> {
    return writeJsonAtomic(file, value);
  }

  async appendJsonl(file: string, value: unknown): Promise<void> {
    await ensureDir(path.dirname(file));
    await fsp.appendFile(file, `${JSON.stringify(value)}\n`, 'utf8');
  }

  /** 깨진 줄(쓰는 도중 끊긴 마지막 줄 포함)은 건너뛰고 경고로 돌려준다. */
  async readJsonl<T>(file: string): Promise<{ items: T[]; warnings: string[] }> {
    const warnings: string[] = [];
    const items: T[] = [];
    if (!(await pathExists(file))) return { items, warnings };
    for await (const rec of readJsonl(file, { warnings })) items.push(rec.value as T);
    return { items, warnings };
  }
}
