declare module 'bundlebee' {
  import ReadyResource from 'ready-resource'
  import Bundle from 'bare-bundle'
  import Bee from 'hyperbee2'

  interface BundlebeeOptions {
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

  class Bundlebee extends ReadyResource {
    constructor(store: any, opts?: BundlebeeOptions) // lunte-disable-line

    static require(
      store: any,
      ...args: [...files: string[], opts: BundlebeeOptions]
    ): Promise<Bundlebee>
    static require(store: any, ...files: string[]): Promise<Bundlebee>

    get(key: string, checkout?: number): Promise<Entry | null>

    checkout(length?: number): Promise<Bee>

    add(root: URL, entrypoint: string, opts?: AddOptions): Promise<Bundle>

    load(root: URL, entrypoint: string, checkout?: number, opts?: LoadOptions): Promise<any>
  }

  export = Bundlebee
}
