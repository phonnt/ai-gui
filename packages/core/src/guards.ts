export function canMutateWhileStreaming(isStreaming: boolean): boolean {
  return !isStreaming;
}

export function requireSessionId(id: string | undefined): asserts id is string {
  if (id === undefined || id === '') {
    throw new Error('session id is required');
  }
}
