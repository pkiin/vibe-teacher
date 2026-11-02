import type { MemoryRecord } from '@vibe-teacher/shared';

/** 외부 서비스의 추출 문장 대신 원기록의 ID만 반환하는 경계. */
export interface MemoryBackend {
  readonly kind?: 'mem0' | 'supermemory';
  readonly databaseProvider?: 'supabase' | 'postgres';
  /** 제공자·모델이 달라지면 기존 문서 매핑을 재사용하지 않는다. */
  readonly indexKey?: string;
  close?(): Promise<void>;
  add(namespace: string, record: MemoryRecord): Promise<string>;
  search(namespace: string, query: string, limit: number, records?: readonly MemoryRecord[]): Promise<string[]>;
}

/** Supermemory 공개 document API. AI 문장 생성은 기존 제공자를 사용한다. */
export class SupermemoryBackend implements MemoryBackend {
  readonly kind = 'supermemory' as const;
  constructor(private readonly key: string, private readonly request: typeof fetch = fetch) {}

  private async post(route: string, body: unknown): Promise<unknown> {
    const response = await this.request(`https://api.supermemory.ai${route}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    // 제공자의 오류 본문에는 인증 정보나 사용자 문장이 들어갈 수 있어 노출하지 않는다.
    if (!response.ok) throw new Error(`Supermemory 요청 실패 (HTTP ${response.status})`);
    return response.json();
  }

  async add(namespace: string, record: MemoryRecord): Promise<string> {
    const result = await this.post('/v3/documents', { content: record.text, containerTag: namespace, customId: `${namespace}-${record.id}`.slice(0, 100), documentDate: record.at,
      metadata: { sourceId: record.sourceId, kind: record.kind }, taskType: 'superrag' }) as { id?: unknown };
    if (typeof result.id !== 'string') throw new Error('Supermemory 저장 응답의 문서 ID를 확인하지 못했습니다');
    return result.id;
  }

  async search(namespace: string, query: string, limit: number): Promise<string[]> {
    const result = await this.post('/v3/search', { q: query, containerTags: [namespace], limit }) as { results?: { documentId?: unknown }[] };
    return (result.results ?? []).flatMap((r) => typeof r.documentId === 'string' ? [r.documentId] : []);
  }
}
