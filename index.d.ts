declare module 'bundlebee' {
  import ReadyResource from 'ready-resource'
  import Bundle from 'bare-bundle'
  import Bee from 'hyperbee2'
  import Hypercore from 'hypercore'

  interface BundlebeeOptions {
    autoUpdate?: boolean
    skipExistingABIs?: boolean
    peerDependencies?: string[]
    [key: string]: any
  }

  interface Entry {
    id: string
    source: Buffer
    resolutions: Record<string, string>
  }

  interface Manifest {
    abi: number
  }

  interface AddOptions {
    skipModules?: boolean
    peerDependencies?: string[]
    abi?: number
    version?: string
    dryRun?: boolean
  }

  interface LoadOptions {
    cache?: Record<string, any>
    skipModules?: boolean
  }

  interface BundleInput {
    bundle: string | Bundle
    abi?: number
  }

  interface ABIRecord {
    checkout: HeadInfo
    manifest: Manifest
  }

  interface HeadInfo {
    key: Buffer
    length: number
  }

  interface VersionCheckout extends HeadInfo {
    version: string
  }

  class Bundlebee extends ReadyResource {
    constructor(store: any, opts?: BundlebeeOptions) // lunte-disable-line

    static require(
      store: any,
      ...args: [...files: (string | BundleInput)[], opts: BundlebeeOptions]
    ): Promise<Bundlebee>
    static require(store: any, ...files: (string | BundleInput)[]): Promise<Bundlebee>
    static bundleFrom(f: string): Bundle

    get core(): Hypercore
    get key(): Buffer
    get discoveryKey(): Buffer

    head(): HeadInfo

    get(key: string, checkout?: HeadInfo): Promise<Entry | null>
    checkout(checkout?: HeadInfo): Promise<Bee>
    resolve(range: string): Promise<VersionCheckout | null>
    manifest(checkout?: HeadInfo): Promise<Manifest | null>
    peerDependencies(checkout?: HeadInfo): Promise<Set<string> | null>

    findABI(abi: number): Promise<HeadInfo | null>
    allABIs(): AsyncIterable<ABIRecord>
    createEntryStream(checkout?: HeadInfo): AsyncIterable<Entry>

    add(root: URL, entrypoint: string, opts?: AddOptions): Promise<Bundle>
    load(root: URL, entrypoint: string, checkout?: HeadInfo, opts?: LoadOptions): Promise<any>

    close(): Promise<void>
  }

  export = Bundlebee
}
