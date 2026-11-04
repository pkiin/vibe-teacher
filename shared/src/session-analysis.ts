/** 저장된 대화 기록 분석 문서. 목록 조회는 AI나 원본 기록 읽기를 시작하지 않는다. */
export interface SessionAnalysisDocument {
  sessionKey: string;
  title: string;
  summary?: string;
  createdAt: string;
  status: 'complete' | 'partial';
  stale: boolean;
  sections: ('summary' | 'wiki' | 'concepts' | 'security')[];
}

export interface SessionAnalysisDocumentsResponse {
  documents: SessionAnalysisDocument[];
  totalSessions: number;
}
