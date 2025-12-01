export class Channel<T> {
  private stream: ReadableStream<T>;
  private writer: WritableStreamDefaultWriter<T>;
  private reader: ReadableStreamDefaultReader<T>;
  private closed = false;

  constructor(bufferSize = 0) {
    let controller: ReadableStreamDefaultController<T>;

    this.stream = new ReadableStream<T>({
      start(c) {
        controller = c;
      }
    }, new CountQueuingStrategy({ highWaterMark: bufferSize }));

    const writable = new WritableStream<T>({
      write(chunk) {
        controller.enqueue(chunk);
      },
      close() {
        controller.close();
      },
      abort(reason) {
        controller.error(reason);
      }
    }, new CountQueuingStrategy({ highWaterMark: bufferSize }));

    this.writer = writable.getWriter();
    this.reader = this.stream.getReader();
  }

  async send(value: T): Promise<void> {
    if (this.closed) {
      throw new Error('Cannot send to a closed channel');
    }
    await this.writer.ready;
    await this.writer.write(value);
  }

  async receive(): Promise<{ value: T | undefined; done: boolean }> {
    const result = await this.reader.read();
    return result;
  }

  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      await this.writer.close();
    }
  }

  isClosed(): boolean {
    return this.closed;
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
    try {
      while (true) {
        const { value, done } = await this.receive();
        if (done) break;
        yield value as T;
      }
    } finally {
      await this.close();
    }
  }
}

