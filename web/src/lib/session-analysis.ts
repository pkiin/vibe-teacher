/** 대화 분석 문서의 고정 주소. 예전 세션 탭 주소도 계속 사용할 수 있다. */
export function sessionAnalysisPath(sessionKey: string, section?: string): string {
  return `/sessions/${encodeURIComponent(sessionKey)}/analysis${section ? `#${encodeURIComponent(section)}` : ''}`;
}

export function conceptAnchor(conceptId: string): string {
  return `concept-${conceptId}`;
}
