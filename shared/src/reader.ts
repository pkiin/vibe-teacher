/**
 * 읽는 사람 수준 — AI 가 문장을 쓸 때 단어와 설명 깊이를 맞추는 기준.
 * 사용자가 스스로 고르는 설정이며 이해 증거가 아니다 (개념 상태·위험 알림에 영향 없음).
 */
import { z } from 'zod';

export const READER_LEVELS = ['non-dev', 'beginner', 'junior', 'senior'] as const;
export type ReaderLevel = (typeof READER_LEVELS)[number];
export const ReaderLevelSchema = z.enum(READER_LEVELS);

/** 기본값은 완전 비개발자 */
export const DEFAULT_READER_LEVEL: ReaderLevel = 'non-dev';

export interface ReaderPrefs {
  readerLevel: ReaderLevel;
  /** 사용자가 직접 골랐는지. 고르기 전에는 AI 자동 작성을 시작하지 않고 먼저 묻는다 */
  chosen: boolean;
  updatedAt?: string;
}

export const ReaderPrefsRequestSchema = z.object({ readerLevel: ReaderLevelSchema });
export type ReaderPrefsRequest = z.infer<typeof ReaderPrefsRequestSchema>;
