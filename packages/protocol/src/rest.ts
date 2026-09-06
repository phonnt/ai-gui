import { z } from 'zod';

export const SessionInfoSchema = z.object({
  id: z.string().min(1),
  cwd: z.string().min(1),
  title: z.string(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const CreateSessionSchema = z.object({
  cwd: z.string().min(1).optional(),
});

export const PromptSchema = z.object({
  text: z.string().min(1),
});

export const MessagesQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(256).default(100),
});

export const HealthSchema = z.object({
  ok: z.boolean(),
  version: z.string().min(1),
  runtime: z.string().min(1),
});

export const SessionListResponseSchema = z.object({
  sessions: z.array(SessionInfoSchema),
});

export const CreateSessionResponseSchema = z.object({
  session: SessionInfoSchema,
});

export const MessagesResponseSchema = z.object({
  messages: z.array(
    z.object({
      id: z.string().min(1),
      role: z.enum(['user', 'assistant', 'system', 'tool']),
      text: z.string(),
      createdAt: z.string().min(1),
    }),
  ),
  nextCursor: z.string().min(1).optional(),
});

export const PromptResponseSchema = z.object({
  accepted: z.boolean(),
});

export const AbortResponseSchema = z.object({
  aborted: z.boolean(),
});

export type SessionInfoDto = z.infer<typeof SessionInfoSchema>;
export type CreateSessionDto = z.infer<typeof CreateSessionSchema>;
export type PromptDto = z.infer<typeof PromptSchema>;
export type MessagesQueryDto = z.infer<typeof MessagesQuerySchema>;
export type HealthDto = z.infer<typeof HealthSchema>;
export type SessionListResponseDto = z.infer<typeof SessionListResponseSchema>;
export type CreateSessionResponseDto = z.infer<typeof CreateSessionResponseSchema>;
export type MessagesResponseDto = z.infer<typeof MessagesResponseSchema>;
export type PromptResponseDto = z.infer<typeof PromptResponseSchema>;
export type AbortResponseDto = z.infer<typeof AbortResponseSchema>;
