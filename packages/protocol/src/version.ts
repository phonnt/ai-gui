export const PROTOCOL_VERSION = '0.1.0';

export function isCompatible(v: string): boolean {
  return v === PROTOCOL_VERSION;
}
