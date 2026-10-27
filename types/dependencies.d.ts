declare module 'hyperbee2' {
  export default class Bee {
    constructor(
      store: import('../lib/storage').Store,
      options?: import('../lib/types').BundlebeeOptions
    )
    readonly core: import('../lib/storage').Core
    readonly store: import('../lib/storage').Store
    ready(): Promise<void>
    close(): Promise<void>
    update(): void
    head(): import('../lib/types').HeadInfo
    get(
      key: Uint8Array,
      options?: import('../lib/storage').ReadOptions
    ): Promise<import('../lib/storage').Row | null>
    move(head: { key: Uint8Array | string; length: number }): Promise<void>
    checkout(
      head?: Partial<import('../lib/types').HeadInfo> & import('../lib/storage').ReadOptions
    ): Bee
    snapshot(options?: import('../lib/storage').ReadOptions): Bee
    write(): import('../lib/storage').WriteBatch
    createReadStream(
      options?: import('../lib/storage').ReadOptions & {
        gte?: Uint8Array
        lt?: Uint8Array
        reverse?: boolean
      }
    ): AsyncIterable<import('../lib/storage').Row>
    createChangesStream(): AsyncIterable<import('../lib/storage').Change>
  }
}
declare module 'scope-lock' {
  export default class ScopeLock {
    lock(): Promise<boolean>
    unlock(): void
  }
}
declare module 'url-file-url' {
  export function fileURLToPath(url: { readonly href: string }): string
  export function pathToFileURL(path: string): import('bare-url')
}
declare const Bare: { readonly platform: string; readonly arch: string }

declare module 'hypercore-id-encoding' {
  export function encode(key: Uint8Array): string
  export function decode(key: string): import('bare-buffer')
}
declare module 'hypercore-crypto' {
  export function randomBytes(length: number): import('bare-buffer')
}
