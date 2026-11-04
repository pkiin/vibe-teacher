export type WorkPhase = 'queued' | 'preparing' | 'reading' | 'ai' | 'writing' | 'done' | 'error' | 'cancelled';

/** 실제 단계 전환으로 갱신하는 예상 진행률. 경과 시간으로 퍼센트를 늘리지 않는다. */
export interface WorkProgress {
  phase: WorkPhase;
  percent: number;
  aiCalls: number;
  active: { reading: number; writing: number; ai: number };
  storage?: 'supabase' | 'local';
}

export interface CloudTableActivity {
  table: string;
  reads: number;
  writes: number;
  errors: number;
  durationMs: number;
  requestBytes: number;
  responseBytes: number;
}

export interface StorageActivityResponse {
  mode: 'supabase' | 'local';
  since?: string;
  tables: CloudTableActivity[];
  cache?: { hits: number; coalesced: number; batches: number; entries: number };
}
