import type Buffer from 'bare-buffer'
import type Bundle from 'bare-bundle'
import type { Core } from './storage'

export interface HeadInfo {
  readonly key: Buffer
  readonly length: number
}

export interface BundlebeeOptions {
  readonly name?: string
  readonly key?: Uint8Array | string
  readonly length?: number
  readonly offline?: boolean
  readonly autoUpdate?: boolean
  readonly skipExistingABIs?: boolean
  readonly peerDependencies?: ReadonlyArray<string>
  readonly wait?: boolean
}

export interface Entry {
  readonly source: Buffer
  readonly resolutions: Record<string, string>
}
export interface ListedEntry extends Entry {
  readonly id: string
}
export interface Manifest {
  readonly abi: number
}
export interface ABIRecord {
  readonly checkout: HeadInfo
  readonly manifest: Manifest
}
export interface AddOptions {
  readonly skipModules?: boolean
  readonly peerDependencies?: ReadonlyArray<string>
  readonly abi?: number
  readonly dryRun?: boolean
  readonly source?: string | Buffer
  readonly pre?: (source: Buffer, path: string) => Buffer | Promise<Buffer>
}
export interface LoadOptions {
  readonly cache?: Record<string, LoadedRelease | NodeModule | undefined>
  readonly skipModules?: boolean
  readonly map?: (path: string, source: Buffer | undefined) => Buffer | null
}
export interface BundleInput {
  readonly bundle: string | Bundle
  readonly abi?: number
}
export interface ReleasePin {
  readonly format: 2
  readonly key: string
  readonly length: number
  readonly name: string
  readonly version: string
  readonly entry: string
  readonly abi: number
}
export interface Signal {
  readonly aborted: boolean
  readonly reason?: unknown
  addEventListener(event: 'abort', listener: () => void, options?: { once?: boolean }): void
  removeEventListener(event: 'abort', listener: () => void): void
}
export interface OperationOptions {
  readonly offline?: boolean
  readonly signal?: Signal
}
export type ReleaseQuery = OperationOptions & { readonly name: string } & (
    | { readonly version: string; readonly abi?: never }
    | { readonly abi: number; readonly version?: never }
  )
export interface HostRequirement {
  readonly version: string
  readonly abi?: string
  readonly platform?: string
  readonly arch?: string
}
export interface HostProvider extends HostRequirement {
  readonly exports: unknown
}
export interface ReleaseAsset {
  readonly path: string
  readonly platform?: string
  readonly arch?: string
}
export interface PublishOptions {
  readonly name: string
  readonly version: string
  readonly abi: number
  readonly assets?: ReadonlyArray<string | ReleaseAsset>
  readonly hostRequirements?: Readonly<Record<string, HostRequirement>>
  readonly platforms?: ReadonlyArray<string>
}
export interface Platform {
  readonly platform: string
  readonly arch: string
}
export interface ReleaseLoadOptions extends OperationOptions {
  readonly assetDirectory?: string | URL
  readonly platform?: Platform
  readonly hostProviders?: Readonly<Record<string, HostProvider>>
}
export interface LoadedRelease {
  readonly exports: unknown
  readonly filename: string
  readonly id: string
}
export interface StoredAsset {
  readonly path: string
  readonly platform: string
  readonly arch: string
}
export interface StoredHost {
  readonly platform: string
  readonly arch: string
  readonly specifier: string
  readonly version: string
  readonly abi: string
}
export interface ReleaseManifest extends Omit<ReleasePin, 'key' | 'length'> {
  readonly files: ReadonlyArray<string>
  readonly assets: ReadonlyArray<StoredAsset>
  readonly hosts: ReadonlyArray<StoredHost>
}
export interface StoredModule {
  readonly source: Buffer
  readonly resolutions: string
}
export type Resolution = string | Resolution[] | ResolutionMap
export interface ResolutionMap {
  [specifier: string]: Resolution
}
export interface ReleaseModule {
  readonly source: Buffer
  readonly resolutions: ResolutionMap
}
export interface ReleaseGraph {
  readonly manifest: ReleaseManifest
  readonly files: Map<string, StoredModule>
  readonly assets: Map<string, Buffer>
}
export interface ReleaseContents {
  readonly manifest: ReleaseManifest
  readonly files: Map<string, ReleaseModule>
  readonly assets: Map<string, Buffer>
}
export type { Core, Store, ReplicationStream } from './storage'
