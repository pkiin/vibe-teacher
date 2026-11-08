import { z } from 'zod';

export const StartStageSchema = z.enum(['idea', 'direction', 'features', 'repository']);
export type StartStage = z.infer<typeof StartStageSchema>;
export const OnboardingRequestSchema = z.object({
  stage: StartStageSchema,
  goal: z.string().trim().max(2000).default(''),
  features: z.string().trim().max(4000).default(''),
  repository: z.string().trim().max(1000).default(''),
});
export type OnboardingRequest = z.infer<typeof OnboardingRequestSchema>;
export type OnboardingProfile = OnboardingRequest & { updatedAt: string };
export interface Member {
  user_id: string;
  email: string;
  approved: boolean;
  is_admin: boolean;
  account_ids: string[];
}
export const MemberUpdateSchema = z.object({
  userId: z.uuid(),
  approved: z.boolean(),
  accountIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,80}$/)).max(100),
});
export const EmailLoginSchema = z.object({ email: z.email().max(254), password: z.string().min(1).max(256) });
export const SignupSchema = EmailLoginSchema.extend({ password: z.string().min(8).max(256) });
export interface SignupResponse { confirmationRequired: boolean }
export const EmailConfirmationSchema = z.object({ accessToken: z.string().min(1).max(16_384) });
export interface EmailConfirmationResponse { confirmed: true }
export const ResendConfirmationSchema = EmailLoginSchema.pick({ email: true });
export const EMAIL_RESEND_COOLDOWN_SECONDS = 60;
export interface ResendConfirmationResponse { requested: true; retryAfterSeconds: number }

/** 노트북 설치(local)가 쓰는 OpenRouter 키의 출처. 셸·.env(env)가 화면에서 저장한 키(saved)보다 우선한다. 키 자체는 화면으로 돌려주지 않는다. */
export type OpenRouterKeySource = 'env' | 'saved' | 'none';
export interface OpenRouterKeyResponse { source: OpenRouterKeySource }
/** OpenRouter 키 모양 (sk-or-v1-…). 공백·줄바꿈이 섞인 붙여 넣기는 받지 않는다 */
export const OPENROUTER_KEY_PATTERN = /^sk-or-[A-Za-z0-9_-]{16,300}$/;
export const OpenRouterKeyRequestSchema = z.object({ key: z.string().trim().max(400) });
