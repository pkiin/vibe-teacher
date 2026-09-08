import { z } from 'zod';

/** LLM이 돌려주는 세션 보강 결과의 스키마. CLI(--json-schema)와 SDK(zodOutputFormat) 양쪽에 그대로 쓰인다. */
export const EnrichmentSchema = z.object({
  summary: z.object({
    title: z.string().describe('세션을 한 줄로 부르는 짧은 제목 (한국어, 40자 이내)'),
    oneLiner: z.string().describe('무엇을 만들었는지 한 문장 요약 (한국어)'),
    narrative: z
      .string()
      .describe('무엇을 어떤 순서로 만들었는지 설명하는 마크다운 (한국어, 짧은 문단 또는 글머리표 3~8개)'),
    features: z
      .array(
        z.object({
          name: z.string().describe('만들어진 기능이나 결과물 이름'),
          detail: z.string().describe('그 기능이 무엇을 하는지 1~2문장'),
          evidence: z.array(z.string()).describe('근거가 된 파일 경로나 명령 (제공된 자료에 있는 것만)'),
        }),
      )
      .describe('만들어진 기능/결과물 목록'),
    outcome: z.enum(['completed', 'partial', 'unclear']).describe('세션에서 목표를 달성했는지'),
    nextSteps: z.array(z.string()).describe('사용자가 다음에 해 볼 만한 일 (한국어, 최대 5개)'),
  }),
  concepts: z
    .array(
      z.object({
        id: z
          .string()
          .nullable()
          .describe('제공된 규칙 기반 개념 후보의 id를 다듬는 경우 그 id, 새 개념이면 null'),
        name: z.string().describe('개념 이름 (한국어, 영어 용어는 괄호로)'),
        explanation: z.string().describe('초보자를 위한 설명 2~4문장 (한국어 존댓말)'),
        whyHere: z.string().describe('이 세션에서 왜 이 개념이 중요했는지, 근거를 들어 1~3문장'),
        example: z.string().nullable().describe('이 세션의 실제 파일/명령을 활용한 짧은 예시, 없으면 null'),
        level: z.enum(['beginner', 'intermediate']),
      }),
    )
    .describe('사용자가 알아야 할 개념 (중요한 순서, 최대 12개)'),
});

export type Enrichment = z.infer<typeof EnrichmentSchema>;

export const ENRICH_PROMPT_VERSION = 1;
