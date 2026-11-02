/** 검색용 기억은 원장에 연결된 개인 활동이다. 검색 점수는 숙련 확률이 아니다. */
export interface MemoryRecord {
  id: string;
  kind: 'question' | 'response' | 'self_report' | 'correction' | 'preference' | 'exposure';
  at: string;
  text: string;
  conceptIds: string[];
  projectId?: string;
  sessionKey?: string;
  sourceId: string;
}

export interface MemorySearchResponse {
  records: MemoryRecord[];
  backend: 'local' | 'mem0' | 'supermemory';
  configuredBackend?: 'local' | 'mem0' | 'supermemory';
  databaseProvider?: 'supabase' | 'postgres';
  notices: string[];
  total: number;
  canSync?: boolean;
}
