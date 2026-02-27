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
    checkout: number
    manifest: Manifest
  }

  interface HeadInfo {
    key: Buffer
    length: number
  }

  class Bundlebee extends ReadyResource {
    constructor(store: any, opts?: BundlebeeOptions)

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

    get(key: string, checkout?: number): Promise<Entry | null>
    checkout(checkout?: number): Promise<Bee>
    manifest(checkout?: number): Promise<Manifest | null>
    peerDependencies(checkout?: number): Promise<Set<string> | null>

    findABI(abi: number): Promise<number | undefined>
    allABIs(): AsyncIterable<ABIRecord>
    createEntryStream(checkout?: number): AsyncIterable<Entry>

    add(root: URL, entrypoint: string, opts?: AddOptions): Promise<Bundle>
    load(root: URL, entrypoint: string, checkout?: number, opts?: LoadOptions): Promise<any>

    close(): Promise<void>
  }

  export = Bundlebee
}
