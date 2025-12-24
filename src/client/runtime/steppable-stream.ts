import {
  createFromReadableStream,
  type CallServerCallback as ImportedCallServerCallback,
} from "react-server-dom-webpack/client";

export type CallServerCallback = ImportedCallServerCallback;

export interface Thenable<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

export interface SteppableStreamOptions {
  callServer?: CallServerCallback;
}

const noop = () => {};
const encoder = new TextEncoder();

export class SteppableStream {
  rows: string[] = [];
  done = false;
  error: Error | null = null;
  flightPromise: Thenable<unknown>;

  private controller!: ReadableStreamDefaultController<Uint8Array>;
  private releasedCount = 0;
  private closed = false;
  private yieldIndex = 0;
  private ping = noop;

  constructor(source: ReadableStream<Uint8Array>, options: SteppableStreamOptions = {}) {
    const { callServer } = options;

    const output = new ReadableStream<Uint8Array>({
      start: (c) => {
        this.controller = c;
      },
    });

    const streamOptions = callServer ? { callServer } : {};
    this.flightPromise = createFromReadableStream(output, streamOptions);
    this.consumeSource(source);
  }

  release(count: number): void {
    if (this.closed) return;

    while (this.releasedCount < count && this.releasedCount < this.rows.length) {
      this.controller.enqueue(encoder.encode(this.rows[this.releasedCount]! + "\n"));
      this.releasedCount++;
    }

    this.maybeClose();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    while (true) {
      while (this.yieldIndex < this.rows.length) {
        yield this.rows[this.yieldIndex++]!;
      }
      if (this.error) throw this.error;
      if (this.done) return;

      await new Promise<void>((resolve) => {
        this.ping = resolve;
      });
      this.ping = noop;
    }
  }

  private async consumeSource(source: ReadableStream<Uint8Array>): Promise<void> {
    const reader = source.getReader();
    const decoder = new TextDecoder();
    let partial = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        partial += decoder.decode(value, { stream: true });
        const lines = partial.split("\n");
        partial = lines.pop() ?? "";

        for (const line of lines) {
          if (line.trim()) {
            this.rows.push(line);
          }
        }
        this.ping();
      }

      partial += decoder.decode();
      if (partial.trim()) {
        this.rows.push(partial);
      }
    } catch (err) {
      this.error = err instanceof Error ? err : new Error(String(err));
    } finally {
      this.done = true;
      this.ping();
      this.maybeClose();
    }
  }

  private maybeClose(): void {
    if (this.closed) return;
    if (this.done && this.releasedCount >= this.rows.length) {
      this.closed = true;
      if (this.error) {
        this.controller.error(this.error);
      } else {
        this.controller.close();
      }
    }
  }
}
