import { useAuth } from '../context/AuthContext';
import { useReader } from './useReader';

/** 표현 난이도에 따른 화면 표시만 제어한다. 설정 변경 권한은 서버에서 별도로 검사한다. */
export function useTechnicalDetails(): boolean {
  const { me } = useAuth();
  const reader = useReader();
  return !!me?.isAdmin || (reader.chosen && (reader.level === 'junior' || reader.level === 'senior'));
}
