import path from 'node:path';
import { DEFAULT_READER_LEVEL, READER_LEVELS, type ReaderLevel, type ReaderPrefs } from '@vibe-teacher/shared';
import type { WikiStorage } from '../storage/store';

/**
 * 사용자 설정(읽는 사람 수준). wiki/learners/<id>/prefs.json
 * 이해 증거가 아니므로 learner 원장에 넣지 않는다.
 */
export class PrefsService {
  constructor(private readonly storage: WikiStorage) {}

  private file(learnerId: string): string {
    return path.join(this.storage.learnerDir(learnerId), 'prefs.json');
  }

  async get(learnerId: string): Promise<ReaderPrefs> {
    const saved = await this.storage.readJson<Partial<ReaderPrefs>>(this.file(learnerId));
    const level = saved?.readerLevel && (READER_LEVELS as readonly string[]).includes(saved.readerLevel) ? saved.readerLevel : DEFAULT_READER_LEVEL;
    return { readerLevel: level, chosen: !!saved?.readerLevel, ...(saved?.updatedAt ? { updatedAt: saved.updatedAt } : {}) };
  }

  async level(learnerId: string): Promise<ReaderLevel> {
    return (await this.get(learnerId)).readerLevel;
  }

  async set(learnerId: string, readerLevel: ReaderLevel): Promise<ReaderPrefs> {
    return this.storage.lock(`prefs:${learnerId}`, async () => {
      const prefs: ReaderPrefs = { readerLevel, chosen: true, updatedAt: new Date().toISOString() };
      await this.storage.writeJson(this.file(learnerId), { readerLevel, updatedAt: prefs.updatedAt });
      return prefs;
    });
  }
}
