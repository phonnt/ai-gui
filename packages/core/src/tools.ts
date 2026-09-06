export interface ToolCallSummary {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error';
  summary?: string;
}
