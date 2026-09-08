import os from 'node:os';
import type { BuiltSummary, ConceptHit, NormalizedSession } from '@vibe-teacher/shared';
import { summarizeBuilt } from './built/index';
import { detectConcepts } from './concepts/index';

export interface Analysis {
  built: BuiltSummary;
  concepts: ConceptHit[];
}

/** 세션별 규칙 기반 분석 결과를 메모리에 캐시한다 (key + mtime 기준) */
export class AnalysisService {
  private cache = new Map<string, Analysis>();
  constructor(private readonly home: string = os.homedir()) {}

  async analyze(session: NormalizedSession): Promise<Analysis> {
    const k = `${session.key}:${session.fileMtime}:${session.fileSize}`;
    const hit = this.cache.get(k);
    if (hit) return hit;
    const built = summarizeBuilt(session, this.home);
    const concepts = detectConcepts(session, built);
    const result = { built, concepts };
    this.cache.set(k, result);
    while (this.cache.size > 64) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return result;
  }
}
