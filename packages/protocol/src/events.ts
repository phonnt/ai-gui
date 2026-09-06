import { z } from 'zod';

export const AgentEventSchema = z.object({
  sessionId: z.string().min(1),
  kind: z.enum(['message-delta', 'message-end', 'agent-end', 'tool-start', 'tool-end', 'error']),
  text: z.string().optional(),
  toolName: z.string().optional(),
  message: z.string().optional(),
});

export const WsFrameSchema = z.object({
  v: z.literal('event'),
  event: AgentEventSchema,
});

export type AgentEventDto = z.infer<typeof AgentEventSchema>;
export type WsFrameDto = z.infer<typeof WsFrameSchema>;
