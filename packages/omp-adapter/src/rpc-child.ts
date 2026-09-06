import { RuntimeUnavailableError } from '@ai-gui/agent-runtime';
import type { RpcResponseFrame } from './mapping.js';

export interface RpcChildOptions {
  cwd?: string;
  ompBin?: string;
  readyTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export type RpcNotificationListener = (frame: Record<string, unknown>) => void;

interface PendingRequest {
  resolve: (value: RpcResponseFrame) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

interface ChunkAssembly {
  parts: string[];
  count: number;
}

const BunGlobal = (globalThis as { Bun?: unknown }).Bun as
  | {
      spawn: (
        cmd: string[],
        options: { cwd?: string; stdin: string; stdout: string; stderr: string },
      ) => {
        stdin: { write: (chunk: string) => void; flush: () => void } | null;
        stdout: AsyncIterable<Uint8Array> | null;
        stderr: AsyncIterable<Uint8Array> | null;
        exited: Promise<number>;
        kill: () => void;
      };
    }
  | undefined;

const TextDecoderCtor =
  (globalThis as { TextDecoder?: new (label: string) => TextDecoder }).TextDecoder ?? TextDecoder;

/**
 * One `omp --mode rpc` child process speaking newline-delimited JSON over
 * stdio. Owns the ready handshake, protocol negotiation, id-correlated
 * requests, and notification fan-out. One instance serves one OMP session.
 */
export class RpcChild {
  private seq = 0;
  private pending = new Map<string, PendingRequest>();
  private notifications = new Set<RpcNotificationListener>();
  private chunks = new Map<string, ChunkAssembly>();
  private readyResolve: ((version: number) => void) | null = null;
  private readyReject: ((err: Error) => void) | null = null;
  private negotiatedVersion = 1;
  private stderrTail: string[] = [];
  private isClosed = false;

  private constructor(
    private readonly proc: {
      stdin: { write: (chunk: string) => void; flush: () => void } | null;
      stdout: AsyncIterable<Uint8Array> | null;
      stderr: AsyncIterable<Uint8Array> | null;
      exited: Promise<number>;
      kill: () => void;
    },
    private readonly requestTimeoutMs: number,
  ) {}

  /** Spawn the child, wait for `ready`, then best-effort negotiate protocol v2. */
  static async spawn(options: RpcChildOptions = {}): Promise<RpcChild> {
    if (!BunGlobal)
      throw new RuntimeUnavailableError('Bun runtime is required to spawn omp --mode rpc');
    if (!TextDecoderCtor)
      throw new RuntimeUnavailableError('TextDecoder is unavailable in this runtime');
    const bin = options.ompBin ?? 'omp';
    let proc: RpcChild['proc'];
    try {
      proc = BunGlobal.spawn([bin, '--mode', 'rpc'], {
        cwd: options.cwd,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      });
    } catch (err) {
      throw new RuntimeUnavailableError(
        `cannot spawn omp --mode rpc: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const child = new RpcChild(proc, options.requestTimeoutMs ?? 60_000);
    child.pumpStdout();
    child.pumpStderr();
    proc.exited.then(
      (code) => child.handleExit(`omp --mode rpc exited with code ${code}`),
      (err: unknown) =>
        child.handleExit(
          `omp --mode rpc exited: ${err instanceof Error ? err.message : String(err)}`,
        ),
    );
    const timeoutMs = options.readyTimeoutMs ?? 10_000;
    await child.waitForReady(timeoutMs);
    try {
      await child.request({ type: 'negotiate_protocol', protocolVersion: 2 }, 5000);
      child.negotiatedVersion = 2;
    } catch {
      child.negotiatedVersion = 1;
    }
    return child;
  }

  get closed(): boolean {
    return this.isClosed;
  }

  get protocolVersion(): number {
    return this.negotiatedVersion;
  }

  /** Send a command frame; resolves with the id-correlated response frame. */
  request(command: Record<string, unknown>, timeoutMs?: number): Promise<RpcResponseFrame> {
    if (this.isClosed)
      return Promise.reject(new RuntimeUnavailableError('omp rpc child is closed'));
    if (!this.proc.stdin)
      return Promise.reject(new RuntimeUnavailableError('omp rpc child has no stdin'));
    this.seq += 1;
    const id = `r${this.seq}`;
    const timeout = timeoutMs ?? this.requestTimeoutMs;
    return new Promise<RpcResponseFrame>((resolve, reject) => {
      const timer =
        timeout > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(
                new RuntimeUnavailableError(`omp rpc request timed out: ${String(command.type)}`),
              );
            }, timeout)
          : undefined;
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.proc.stdin?.write(`${JSON.stringify({ ...command, id })}\n`);
        this.proc.stdin?.flush();
      } catch (err) {
        const pending = this.pending.get(id);
        if (pending) {
          this.pending.delete(id);
          if (pending.timer !== undefined) clearTimeout(pending.timer);
        }
        reject(
          new RuntimeUnavailableError(
            `failed to write to omp rpc child: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    });
  }

  /** Subscribe to non-response notification frames. Returns an unsubscribe fn. */
  onNotification(listener: RpcNotificationListener): () => void {
    this.notifications.add(listener);
    return () => {
      this.notifications.delete(listener);
    };
  }

  /** Kill the child and fail all in-flight requests. Idempotent. */
  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    try {
      this.proc.kill();
    } catch {
      /* already gone */
    }
    const err = new RuntimeUnavailableError('omp rpc child closed');
    for (const [, pending] of this.pending) {
      if (pending.timer !== undefined) clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
    if (this.readyReject) {
      this.readyReject(err);
      this.readyResolve = null;
      this.readyReject = null;
    }
  }

  private waitForReady(timeoutMs: number): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.readyResolve = null;
        this.readyReject = null;
        this.close();
        reject(new RuntimeUnavailableError('timed out waiting for omp rpc ready handshake'));
      }, timeoutMs);
      this.readyResolve = (version: number) => {
        clearTimeout(timer);
        this.readyResolve = null;
        this.readyReject = null;
        resolve(version);
      };
      this.readyReject = (err: Error) => {
        clearTimeout(timer);
        this.readyResolve = null;
        this.readyReject = null;
        reject(err);
      };
    });
  }

  private async pumpStdout(): Promise<void> {
    const decoder = new TextDecoderCtor('utf-8');
    let buffer = '';
    try {
      if (!this.proc.stdout) {
        this.handleExit('omp --mode rpc has no stdout');
        return;
      }
      for await (const chunk of this.proc.stdout) {
        buffer += decoder.decode(chunk, { stream: true });
        let index = buffer.indexOf('\n');
        while (index >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (line) this.handleLine(line);
          index = buffer.indexOf('\n');
        }
        if (this.isClosed) return;
      }
    } catch {
      /* stream torn down by close/exit */
    }
    if (!this.isClosed) this.handleExit('omp --mode rpc stdout ended');
  }

  private async pumpStderr(): Promise<void> {
    const decoder = new TextDecoderCtor('utf-8');
    try {
      if (!this.proc.stderr) return;
      for await (const chunk of this.proc.stderr) {
        const text = decoder.decode(chunk, { stream: true });
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          this.stderrTail.push(trimmed);
          if (this.stderrTail.length > 20) this.stderrTail.shift();
        }
        if (this.isClosed) return;
      }
    } catch {
      /* ignore */
    }
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (parsed === null || typeof parsed !== 'object') return;
    const frame = parsed as Record<string, unknown>;
    if (frame.type === 'rpc_chunk') {
      const assembled = this.accumulateChunk(frame);
      if (assembled) this.handleFrame(assembled);
      return;
    }
    this.handleFrame(frame);
  }

  private accumulateChunk(frame: Record<string, unknown>): Record<string, unknown> | null {
    const { chunkId, index, count, data } = frame as {
      chunkId?: unknown;
      index?: unknown;
      count?: unknown;
      data?: unknown;
    };
    if (typeof chunkId !== 'string' || typeof data !== 'string') return null;
    let assembly = this.chunks.get(chunkId);
    if (!assembly) {
      assembly = { parts: [], count: typeof count === 'number' ? count : Number.MAX_SAFE_INTEGER };
      this.chunks.set(chunkId, assembly);
    }
    assembly.parts[typeof index === 'number' ? index : assembly.parts.length] = data;
    const received = assembly.parts.filter((part) => part !== undefined).length;
    if (received < assembly.count) return null;
    this.chunks.delete(chunkId);
    try {
      const joined = assembly.parts.join('');
      const parsed: unknown = JSON.parse(joined);
      if (parsed !== null && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      /* fall through */
    }
    return null;
  }

  private handleFrame(frame: Record<string, unknown>): void {
    if (frame.type === 'ready') {
      const version = typeof frame.protocolVersion === 'number' ? frame.protocolVersion : 1;
      this.readyResolve?.(version);
      return;
    }
    if (frame.type === 'response' && typeof frame.id === 'string') {
      const pending = this.pending.get(frame.id);
      if (pending) {
        this.pending.delete(frame.id);
        if (pending.timer !== undefined) clearTimeout(pending.timer);
        pending.resolve(frame as unknown as RpcResponseFrame);
        return;
      }
    }
    for (const listener of this.notifications) {
      try {
        listener(frame);
      } catch {
        /* listener errors must not break the pump */
      }
    }
  }

  private handleExit(reason: string): void {
    if (this.isClosed) return;
    this.isClosed = true;
    const tail = this.stderrTail.length > 0 ? `: ${this.stderrTail.join(' | ')}` : '';
    const err = new RuntimeUnavailableError(`${reason}${tail}`);
    for (const [, pending] of this.pending) {
      if (pending.timer !== undefined) clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
    if (this.readyReject) {
      this.readyReject(err);
      this.readyResolve = null;
      this.readyReject = null;
    }
  }
}
