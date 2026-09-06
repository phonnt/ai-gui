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

export const TreeNodeSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  role: z.enum(['user', 'assistant', 'system', 'tool', 'branch', 'system-event']),
  preview: z.string(),
  createdAt: z.string().min(1),
});

export const TreeResponseSchema = z.object({
  nodes: z.array(TreeNodeSchema),
  leafId: z.string().min(1).nullable(),
});

export const NavigateSchema = z.object({
  leafId: z.string().min(1),
});

export const BranchSchema = z.object({
  parentId: z.string().min(1).optional(),
});

export const ExportResponseSchema = z.object({
  html: z.string(),
});

export const DumpResponseSchema = z.object({
  text: z.string(),
});

export const ShareResponseSchema = z.object({
  url: z.string().min(1),
});

export const RenameSchema = z.object({
  title: z.string().min(1),
});

export const OkSchema = z.object({
  ok: z.literal(true),
});
export const DropResponseSchema = z.object({
  dropped: z.boolean(),
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

export type TreeNodeDto = z.infer<typeof TreeNodeSchema>;
export type TreeResponseDto = z.infer<typeof TreeResponseSchema>;
export type NavigateDto = z.infer<typeof NavigateSchema>;
export type BranchDto = z.infer<typeof BranchSchema>;
export type ExportResponseDto = z.infer<typeof ExportResponseSchema>;
export type DumpResponseDto = z.infer<typeof DumpResponseSchema>;
export type ShareResponseDto = z.infer<typeof ShareResponseSchema>;
export type RenameDto = z.infer<typeof RenameSchema>;
export type OkDto = z.infer<typeof OkSchema>;
export type DropResponseDto = z.infer<typeof DropResponseSchema>;
