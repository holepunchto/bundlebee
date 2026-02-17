declare module 'bundlebee' {
  import ReadyResource from 'ready-resource'
  import Bundle from 'bare-bundle'
  import Bee from 'hyperbee2'

  interface BundleBeeOptions {
    [key: string]: any
  }

  interface Entry {
    source: Buffer
    resolutions: Record<string, string>
  }

  interface AddOptions {
    skipModules?: boolean
  }

  interface LoadOptions {
    cache?: Record<string, any>
    skipModules?: boolean
  }

  class BundleBee extends ReadyResource {
    constructor(store: any, opts?: BundleBeeOptions)

    static require(
      store: any,
      ...args: [...files: string[], opts: BundleBeeOptions]
    ): Promise<BundleBee>
    static require(store: any, ...files: string[]): Promise<BundleBee>

    get(key: string, checkout?: number): Promise<Entry | null>

    checkout(length?: number): Promise<Bee>

    add(root: URL, entrypoint: string, opts?: AddOptions): Promise<Bundle>

    load(root: URL, entrypoint: string, checkout?: number, opts?: LoadOptions): Promise<any>
  }

  export = BundleBee
}
