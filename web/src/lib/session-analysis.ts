/** 대화 분석 문서의 고정 주소. 예전 세션 탭 주소도 계속 사용할 수 있다. */
export function sessionAnalysisPath(sessionKey: string, section?: string): string {
  return `/sessions/${encodeURIComponent(sessionKey)}/analysis${section ? `#${encodeURIComponent(section)}` : ''}`;
}

export function conceptAnchor(conceptId: string): string {
  return `concept-${conceptId}`;
}

/** 분석 문서를 열면서 도움 패널을 이 개념의 질문 탭으로 연다 (내 지식의 "질문하기") */
export function askConceptPath(sessionKey: string, conceptId: string): string {
  return `/sessions/${encodeURIComponent(sessionKey)}/analysis?ask=${encodeURIComponent(conceptId)}#${encodeURIComponent(conceptAnchor(conceptId))}`;
}

/** ?ask= 의 개념 ID. 개념 ID 형식이 아니면 무시한다 */
export function askedConcept(params: URLSearchParams): string | null {
  const id = params.get('ask');
  return id && /^[a-z0-9-]{1,64}$/.test(id) ? id : null;
}
