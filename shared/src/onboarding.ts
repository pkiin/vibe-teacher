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
