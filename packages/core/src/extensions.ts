export interface ModelRef {
  provider: string;
  id: string;
}

export type McpServerStatus = 'connected' | 'connecting' | 'disconnected' | 'error';
