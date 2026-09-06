export type SubagentStatus = 'running' | 'done' | 'error';

export interface SubagentInfo {
  id: string;
  name: string;
  status: SubagentStatus;
  task?: string;
}
