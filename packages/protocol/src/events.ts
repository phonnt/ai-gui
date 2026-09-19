import { z } from 'zod';
import { GoalStateSchema, PlanProposalSchema } from './rest';

export const AgentEventSchema = z.object({
  sessionId: z.string().min(1),
  kind: z.enum([
    'message-delta',
    'thinking-delta',
    'message-end',
    'agent-end',
    'tool-start',
    'tool-end',
    'approval-request',
    'goal',
    'plan-proposal',
    'error',
  ]),
  text: z.string().optional(),
  toolName: z.string().optional(),
  message: z.string().optional(),
  approvalId: z.string().min(1).optional(),
  prompt: z.string().optional(),
  /** Goal state snapshot (kind === 'goal'), pushed on every goal mutation. */
  goal: GoalStateSchema.optional(),
  /** Plan awaiting review (kind === 'plan-proposal'). */
  plan: PlanProposalSchema.optional(),
});

export const WsFrameSchema = z.object({
  v: z.literal('event'),
  event: AgentEventSchema,
});

export type AgentEventDto = z.infer<typeof AgentEventSchema>;
export type WsFrameDto = z.infer<typeof WsFrameSchema>;
