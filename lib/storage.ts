import type Buffer from 'bare-buffer'
import type { HeadInfo } from './types'
export interface Core {
  readonly key: Buffer
  readonly discoveryKey: Buffer
  readonly length: number
  readonly writable: boolean
  readonly closing: Promise<void> | null
  readonly constructor: { destroyRequests(requests: object[], error?: Error): void }
  ready(): Promise<void>
  update(options?: { wait?: boolean }): Promise<boolean>
  get(index: number, options?: { wait?: boolean }): Promise<Buffer | null>
  close(): Promise<void>
  findingPeers(): () => void
}
export interface Store {
  readonly opened: boolean
  readonly closing: Promise<void> | null
  session(): Store
  replicate(stream: ReplicationStream): void
  get(options?: object): Core
  close(): Promise<void>
}
export interface ReadOptions {
  readonly wait?: boolean
  readonly activeRequests?: object[]
}
export interface Row {
  readonly key: Buffer
  readonly value: Buffer
}
export interface Change {
  readonly head: HeadInfo
  readonly batch: ReadonlyArray<{ readonly keys?: ReadonlyArray<Row> }>
}
export interface WriteBatch {
  tryPut(key: Uint8Array, value: Uint8Array): void
  tryDelete(key: Uint8Array): void
  flush(): Promise<void>
  close(): Promise<void>
}

export interface ReplicationStream {
  on(event: 'error', listener: (error: Error) => void): this
  once(event: 'close', listener: () => void): this
  destroy(): void
}

export interface ReadTree {
  get(key: Uint8Array, options?: ReadOptions): Promise<Row | null>
  createReadStream(options?: ReadOptions): AsyncIterable<Row>
  close(): Promise<void>
}
