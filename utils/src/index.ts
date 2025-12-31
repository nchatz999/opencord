export type Result<T, E = Error> = Ok<T, E> | Err<T, E>;

export interface Ok<T, E = Error> {
  readonly ok: true;
  readonly value: T;
  readonly error?: never;


  map<U>(fn: (value: T) => U): Result<U, E>;
  mapError<F>(fn: (error: E) => F): Result<T, F>;


  flatMap<U>(fn: (value: T) => Result<U, E>): Result<U, E>;


  match<R>(patterns: { ok: (value: T) => R; err: (error: E) => R }): R;


  isOk(): this is Ok<T, E>;
  isErr(): this is Err<T, E>;
  unwrap(): T;
  unwrapOr(defaultValue: T): T;
  unwrapOrElse(fn: (error: E) => T): T;
  expect(message: string): T;


  mapAsync<U>(fn: (value: T) => Promise<U>): Promise<Result<U, E>>;
  flatMapAsync<U>(
    fn: (value: T) => Promise<Result<U, E>>
  ): Promise<Result<U, E>>;
}

export interface Err<T, E = Error> {
  readonly ok: false;
  readonly value?: never;
  readonly error: E;


  map<U>(fn: (value: T) => U): Result<U, E>;
  mapError<F>(fn: (error: E) => F): Result<T, F>;


  flatMap<U>(fn: (value: T) => Result<U, E>): Result<U, E>;


  match<R>(patterns: { ok: (value: T) => R; err: (error: E) => R }): R;


  isOk(): this is Ok<T, E>;
  isErr(): this is Err<T, E>;
  unwrap(): never;
  unwrapOr(defaultValue: T): T;
  unwrapOrElse(fn: (error: E) => T): T;
  expect(message: string): never;


  mapAsync<U>(fn: (value: T) => Promise<U>): Promise<Result<U, E>>;
  flatMapAsync<U>(
    fn: (value: T) => Promise<Result<U, E>>
  ): Promise<Result<U, E>>;
}

export function ok<T, E = Error>(value: T): Result<T, E> {
  return {
    ok: true,
    value,

    map<U>(fn: (value: T) => U): Result<U, E> {
      return ok(fn(value));
    },

    mapError<F>(_fn: (error: E) => F): Result<T, F> {
      return ok(value);
    },

    flatMap<U>(fn: (value: T) => Result<U, E>): Result<U, E> {
      return fn(value);
    },

    match<R>(patterns: { ok: (value: T) => R; err: (error: E) => R }): R {
      return patterns.ok(value);
    },

    isOk(): boolean {
      return true;
    },

    isErr(): boolean {
      return false;
    },

    unwrap(): T {
      return value;
    },

    unwrapOr(_defaultValue: T): T {
      return value;
    },

    unwrapOrElse(_fn: (error: E) => T): T {
      return value;
    },

    expect(_message: string): T {
      return value;
    },

    async mapAsync<U>(fn: (value: T) => Promise<U>): Promise<Result<U, E>> {
      try {
        const newValue = await fn(value);
        return ok(newValue);
      } catch (error) {
        return err(error as E);
      }
    },

    async flatMapAsync<U>(
      fn: (value: T) => Promise<Result<U, E>>
    ): Promise<Result<U, E>> {
      return fn(value);
    },
  } as Ok<T, E>;
}

export function err<T, E = Error>(error: E): Result<T, E> {
  return {
    ok: false,
    error,

    map<U>(_fn: (value: T) => U): Result<U, E> {
      return err(error);
    },

    mapError<F>(fn: (error: E) => F): Result<T, F> {
      return err(fn(error));
    },

    flatMap<U>(_fn: (value: T) => Result<U, E>): Result<U, E> {
      return err(error);
    },

    match<R>(patterns: { ok: (value: T) => R; err: (error: E) => R }): R {
      return patterns.err(error);
    },

    isOk(): boolean {
      return false;
    },

    isErr(): boolean {
      return true;
    },

    unwrap(): never {
      throw new Error(`Called unwrap on an Err value: ${String(error)}`);
    },

    unwrapOr(defaultValue: T): T {
      return defaultValue;
    },

    unwrapOrElse(fn: (error: E) => T): T {
      return fn(error);
    },

    expect(message: string): never {
      throw new Error(`${message}: ${String(error)}`);
    },

    async mapAsync<U>(_fn: (value: T) => Promise<U>): Promise<Result<U, E>> {
      return err(error);
    },

    async flatMapAsync<U>(
      _fn: (value: T) => Promise<Result<U, E>>
    ): Promise<Result<U, E>> {
      return err(error);
    },
  } as Err<T, E>;
}

export function match<T, E, R>(
  result: Result<T, E>,
  patterns: {
    ok: (value: T) => R;
    err: (error: E) => R;
  }
): R {
  return result.match(patterns);
}

export class RingBuffer<T> {
  private buffer: T[];
  private head: number = 0;
  private tail: number = 0;
  private size: number = 0;
  private capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  push(item: T): boolean {
    if (this.size === this.capacity) {
      this.head = (this.head + 1) % this.capacity;
    } else {
      this.size++;
    }

    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;
    return true;
  }

  pop(): T | undefined {
    if (this.size === 0) {
      return undefined;
    }

    this.tail = (this.tail - 1 + this.capacity) % this.capacity;
    const item = this.buffer[this.tail];
    this.size--;
    return item;
  }

  shift(): T | undefined {
    if (this.size === 0) {
      return undefined;
    }

    const item = this.buffer[this.head];
    this.head = (this.head + 1) % this.capacity;
    this.size--;
    return item;
  }

  peek(): T | undefined {
    if (this.size === 0) {
      return undefined;
    }
    return this.buffer[this.head];
  }

  peekLast(): T | undefined {
    if (this.size === 0) {
      return undefined;
    }
    return this.buffer[(this.tail - 1 + this.capacity) % this.capacity];
  }

  get(index: number): T | undefined {
    if (index < 0 || index >= this.size) {
      return undefined;
    }
    return this.buffer[(this.head + index) % this.capacity];
  }

  clear(): void {
    this.head = 0;
    this.tail = 0;
    this.size = 0;
  }

  isFull(): boolean {
    return this.size === this.capacity;
  }

  isEmpty(): boolean {
    return this.size === 0;
  }

  length(): number {
    return this.size;
  }

  getCapacity(): number {
    return this.capacity;
  }

  toArray(): T[] {
    const result = new Array(this.size);
    for (let i = 0; i < this.size; i++) {
      result[i] = this.buffer[(this.head + i) % this.capacity];
    }
    return result;
  }

  forEach(callback: (item: T, index: number) => void): void {
    for (let i = 0; i < this.size; i++) {
      callback(this.buffer[(this.head + i) % this.capacity], i);
    }
  }
}



interface TimerManager {
  setTimeout(callback: Function, delay: number): number;
  setInterval(callback: Function, interval: number): number;
  clearTimeout(id: number): void;
  clearInterval(id: number): void;
  terminate(): void;
}

declare global {
  interface Window {
    process?: { versions?: { electron?: string } };
  }
}

const isElectron = typeof window !== 'undefined' &&
  !!(window.process?.versions?.electron || navigator.userAgent.includes('Electron'));

class NativeTimerManager implements TimerManager {
  setTimeout(callback: Function, delay: number): number {
    return window.setTimeout(callback, delay);
  }

  setInterval(callback: Function, interval: number): number {
    return window.setInterval(callback, interval);
  }

  clearTimeout(id: number): void {
    window.clearTimeout(id);
  }

  clearInterval(id: number): void {
    window.clearInterval(id);
  }

  terminate(): void {}
}

const workerCode = `
  const timers = new Map();
  let nextId = 1;

  self.onmessage = (e) => {
    const { type, id, delay, interval } = e.data;

    switch (type) {
      case 'setTimeout':
        const timeoutId = setTimeout(() => {
          self.postMessage({ type: 'timeout', id });
          timers.delete(id);
        }, delay);
        timers.set(id, timeoutId);
        break;

      case 'setInterval':
        const intervalId = setInterval(() => {
          self.postMessage({ type: 'interval', id });
        }, interval);
        timers.set(id, intervalId);
        break;

      case 'clear':
        const timerId = timers.get(id);
        if (timerId !== undefined) {
          clearTimeout(timerId);
          clearInterval(timerId);
          timers.delete(id);
        }
        break;
    }
  };
`;


class WorkerTimerManager implements TimerManager {
  private worker: Worker;
  private callbacks: Map<number, Function>;
  private nextId: number = 1;

  constructor() {

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    this.worker = new Worker(URL.createObjectURL(blob));
    this.callbacks = new Map();


    this.worker.onmessage = (e) => {
      const { type, id } = e.data;
      const callback = this.callbacks.get(id);

      if (callback) {
        callback();


        if (type === 'timeout') {
          this.callbacks.delete(id);
        }
      }
    };
  }

  setTimeout(callback: Function, delay: number): number {
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    this.worker.postMessage({ type: 'setTimeout', id, delay });
    return id;
  }

  setInterval(callback: Function, interval: number): number {
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    this.worker.postMessage({ type: 'setInterval', id, interval });
    return id;
  }

  clearTimeout(id: number): void {
    this.callbacks.delete(id);
    this.worker.postMessage({ type: 'clear', id });
  }

  clearInterval(id: number): void {
    this.callbacks.delete(id);
    this.worker.postMessage({ type: 'clear', id });
  }

  terminate(): void {
    this.worker.terminate();
    this.callbacks.clear();
  }
}


export const timerManager: TimerManager = isElectron
  ? new NativeTimerManager()
  : new WorkerTimerManager();


export class MinHeap<T> {
  private heap: T[] = [];
  private comparator: (a: T, b: T) => number;

  constructor(comparator: (a: T, b: T) => number) {
    this.comparator = comparator;
  }

  insert(val: T): void {
    this.heap.push(val);
    this.bubbleUp(this.heap.length - 1);
  }

  peek(): T | null {
    return this.heap.length > 0 ? this.heap[0] : null;
  }

  extractMin(): T | null {
    if (this.heap.length === 0) return null;
    if (this.heap.length === 1) return this.heap.pop()!;

    const min = this.heap[0];
    this.heap[0] = this.heap.pop()!;
    this.bubbleDown(0);
    return min;
  }

  size(): number {
    return this.heap.length;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.comparator(this.heap[parentIndex], this.heap[index]) <= 0) break;

      [this.heap[parentIndex], this.heap[index]] = [this.heap[index], this.heap[parentIndex]];
      index = parentIndex;
    }
  }

  private bubbleDown(index: number): void {
    const lastIndex = this.heap.length - 1;
    while (true) {
      const leftChildIndex = 2 * index + 1;
      const rightChildIndex = 2 * index + 2;
      let smallestIndex = index;

      if (leftChildIndex <= lastIndex && this.comparator(this.heap[leftChildIndex], this.heap[smallestIndex]) < 0) {
        smallestIndex = leftChildIndex;
      }
      if (rightChildIndex <= lastIndex && this.comparator(this.heap[rightChildIndex], this.heap[smallestIndex]) < 0) {
        smallestIndex = rightChildIndex;
      }

      if (smallestIndex === index) break;
      [this.heap[index], this.heap[smallestIndex]] = [this.heap[smallestIndex], this.heap[index]];
      index = smallestIndex;
    }
  }
}
