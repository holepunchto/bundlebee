import URL from 'bare-url'
import traverse from 'bare-module-traverse'
import resolveBare from 'bare-module-traverse/resolve/bare'
import Bundle from 'bare-bundle'
import Module from 'bare-module'
import { fileURLToPath } from 'url-file-url'
import fs from 'fs'
import b4a from 'b4a'
import ReadyResource from 'ready-resource'
import Bee from 'hyperbee2'
import c from 'compact-encoding'
import { getEncoding } from './schema'
import { validatePin } from './lib/records'
import { collectGraph } from './lib/graph'
import { publishRelease, resolveRelease, readRelease } from './lib/catalog'
import { loadModules } from './lib/modules'
import { Requests } from './lib/requests'
import { ReleaseError } from './lib/errors'
import type { Store, Core, ReadTree } from './lib/storage'
import Buffer from 'bare-buffer'
import type {
  Resolution,
  BundlebeeOptions,
  BundleInput,
  ReleasePin,
  PublishOptions,
  ReleaseQuery,
  OperationOptions,
  ReleaseLoadOptions,
  AddOptions,
  LoadOptions,
  HeadInfo,
  LoadedRelease,
  Entry as EntryRecord,
  ListedEntry,
  Manifest as ManifestRecord,
  ABIRecord
} from './lib/types'

const Entry = getEncoding('@bundlebee/entry')
const Manifest = getEncoding('@bundlebee/manifest')
const PeerDeps = getEncoding('@bundlebee/peer-deps')

const MANIFEST_KEY_VALUE = '#manifest'
const MANIFEST_KEY = Buffer.from(MANIFEST_KEY_VALUE)
const PEERDEPS_KEY_VALUE = '#peer-deps'
const PEERDEPS_KEY = Buffer.from(PEERDEPS_KEY_VALUE)

export default class Bundlebee extends ReadyResource {
  readonly offline: boolean
  readonly store: Store
  readonly options: BundlebeeOptions
  private _bee: Bee | null

  constructor(store: Store, options: BundlebeeOptions = {}) {
    super()
    this.store = store
    this.options = options
    this.offline = options.offline ?? false
    this._bee = null
  }

  static validateRelease(pin: unknown): ReleasePin {
    return validatePin(pin)
  }

  async publish(
    rootURL: { readonly href: string },
    entry: string,
    options: PublishOptions
  ): Promise<ReleasePin> {
    if (!this.opened) await this.ready()
    const graph = await collectGraph(new URL(rootURL.href), entry, options)
    return publishRelease(this.tree, graph)
  }

  async resolve(query: ReleaseQuery): Promise<ReleasePin> {
    if (!this.opened) await this.ready()
    return resolveRelease(this.tree, { ...query, offline: query.offline ?? this.offline })
  }

  async prefetch(pin: ReleasePin, options: OperationOptions = {}): Promise<ReleasePin> {
    if (!this.opened) await this.ready()
    await readRelease(this.tree, pin, { ...options, offline: options.offline ?? this.offline })
    return pin
  }

  async loadRelease(pin: ReleasePin, options: ReleaseLoadOptions = {}): Promise<LoadedRelease> {
    if (!this.opened) await this.ready()
    const contents = await readRelease(this.tree, pin, {
      ...options,
      offline: options.offline ?? this.offline
    })
    return loadModules(pin, contents, options)
  }

  async update(options: OperationOptions = {}): Promise<boolean> {
    if (!this.opened) await this.ready()
    const requests = new Requests(this.core, options)
    try {
      requests.check()
      const updated = await this.core.update(requests.config)
      requests.check()
      return updated
    } catch (cause) {
      return requests.fail(cause)
    } finally {
      requests.close()
    }
  }

  private get tree(): Bee {
    if (this.closing) throw new ReleaseError('ERR_RESOURCE_CLOSED', 'Bundle is closing')
    return this._bee!
  }

  static async require(
    store: Store,
    ...inputs: Array<string | BundleInput | BundlebeeOptions>
  ): Promise<Bundlebee> {
    const options =
      [...inputs]
        .reverse()
        .find(
          (input): input is BundlebeeOptions => typeof input === 'object' && !('bundle' in input)
        ) ?? {}
    const bee = new Bundlebee(store, options)
    const manifest = await bee.manifest()
    for (const input of inputs) {
      if (typeof input !== 'string' && !('bundle' in input)) continue
      const data = typeof input === 'string' ? { bundle: input, abi: 0 } : input
      if (options.skipExistingABIs && manifest && (data.abi ?? 0) <= manifest.abi) continue
      const bundle =
        typeof data.bundle === 'string' ? Bundlebee.bundleFrom(data.bundle) : data.bundle
      await bee._addBundle({ bundle, abi: data.abi }, options)
    }
    return bee
  }

  static bundleFrom(f: string): Bundle {
    if (f.endsWith('.js')) {
      const loadBundle: (filename: string) => Bundle = require
      return loadBundle(f)
    }

    return Bundle.from(Buffer.from(fs.readFileSync(f)))
  }

  get core(): Core {
    return this.tree.core
  }

  head(): HeadInfo {
    return this.tree.head()
  }

  get key(): Buffer {
    return this.tree.core.key
  }

  get discoveryKey(): Buffer {
    return this.tree.core.discoveryKey
  }

  async _open(): Promise<void> {
    const { key, length = -1 } = this.options
    this._bee = new Bee(this.store, {
      ...this.options,
      autoUpdate: this.offline ? false : (this.options.autoUpdate ?? (!key || length === -1)),
      wait: this.offline ? false : this.options.wait
    })
    try {
      await this._bee.ready()
      if (this.closing) return
      if (key && length !== -1) await this._bee.move({ key, length })
    } catch (error) {
      await this._bee.close()
      throw error
    }
  }

  async _close(): Promise<void> {
    if (this._bee) await this._bee.close()
    else await this.store.close()
  }

  async *createEntryStream(checkout?: HeadInfo): AsyncGenerator<ListedEntry> {
    if (!this.opened) await this.ready()
    const b = checkout ? await this.checkout(checkout) : this.tree

    try {
      for await (const data of b.createReadStream()) {
        const id = data.key.toString()
        if (id.startsWith('#')) continue
        const entry = c.decode(Entry, data.value)
        yield { ...entry, id }
      }
    } finally {
      if (checkout) await b.close()
    }
  }

  async manifest(checkout?: HeadInfo): Promise<ManifestRecord | null> {
    if (!this.opened) await this.ready()

    const b = checkout ? await this.checkout(checkout) : this.tree

    try {
      const entry = await b.get(MANIFEST_KEY)
      if (!entry) return null

      return c.decode(Manifest, entry.value)
    } finally {
      if (checkout) await b.close()
    }
  }

  async peerDependencies(checkout?: HeadInfo): Promise<Set<string> | null> {
    if (!this.opened) await this.ready()

    const b = checkout ? await this.checkout(checkout) : this.tree

    try {
      const entry = await b.get(Buffer.from('#peer-deps'))
      if (!entry) return null

      const { packages } = c.decode(PeerDeps, entry.value)

      return new Set(packages)
    } finally {
      if (checkout) await b.close()
    }
  }

  async get(key: string, checkout?: HeadInfo): Promise<EntryRecord | null> {
    if (!this.opened) await this.ready()

    const b = checkout ? await this.checkout(checkout) : this.tree

    try {
      const entry = await b.get(Buffer.from(key))
      if (!entry) return null

      return c.decode(Entry, entry.value)
    } finally {
      if (checkout) await b.close()
    }
  }

  async findABI(abi: number): Promise<HeadInfo | null> {
    if (!this.opened) await this.ready()
    for await (const d of this.tree.createChangesStream()) {
      let record = null
      for (const b of d.batch) {
        if (!b.keys) continue
        const r = b.keys.find((k) => k.key.toString() === MANIFEST_KEY_VALUE)
        if (!r) continue
        record = r
      }
      if (!record) continue

      const manifest = c.decode(Manifest, record.value)
      if (manifest.abi !== abi) continue

      return d.head
    }
    return null
  }

  async *allABIs(): AsyncGenerator<ABIRecord> {
    if (!this.opened) await this.ready()
    for await (const d of this.tree.createChangesStream()) {
      let record = null
      for (const b of d.batch) {
        if (!b.keys) continue
        const r = b.keys.find((k) => k.key.toString() === MANIFEST_KEY_VALUE)
        if (!r) continue
        record = r
      }
      if (!record) continue

      const manifest = c.decode(Manifest, record.value)

      yield { checkout: d.head, manifest }
    }
  }

  async checkout(checkout?: HeadInfo): Promise<ReadTree> {
    if (!this.opened) await this.ready()

    return this.tree.checkout(checkout)
  }

  async load(
    rootURL: { readonly href: string },
    entry: string,
    checkout?: HeadInfo,
    { cache = require.cache, skipModules = true, map }: LoadOptions = {}
  ): Promise<LoadedRelease> {
    const root = new URL(rootURL.href)
    if (!this.opened) await this.ready()
    if (!(await this.get(entry, checkout))) throw new Error(`${entry} not found`)

    const b = await this.checkout(checkout)
    try {
      const loadedData = new Map<string, Buffer>()

      const protocol = new Module.Protocol({
        exists(url) {
          return true
        },
        read(url) {
          const p = url.pathname
          const loaded = loadedData.get(p)
          if (map) return map(p, loaded)
          return loaded ?? null
        }
      })

      const bundleCache: Module.Cache = Object.create(null)
      const builtins: Record<string, unknown> = Object.create(null)
      const allResolutions: Record<string, Record<string, string>> = {}

      const peerDeps = await this.peerDependencies(checkout)

      for await (const data of b.createReadStream()) {
        const id = data.key.toString()
        if (id.startsWith('#')) continue

        const { resolutions, source } = c.decode(Entry, data.value)

        loadedData.set(id, source)

        const m: Record<string, string> = {}
        for (const [k, v] of Object.entries(resolutions)) {
          const skip = peerDeps && peerDeps.has(k)
          const nm =
            (v.includes('node_modules/') && skipModules) || skip ? findModule(cache, v, root) : null
          if (nm) {
            m[k] = 'builtin:bundlebee-host-' + Object.keys(builtins).length
            builtins[m[k].slice(8)] = nm.exports
          } else {
            m[k] = 'bundle://layer' + v
          }
        }
        allResolutions['bundle://layer' + id] = m
      }

      return await Module.load(new URL(entry, 'bundle://layer/'), {
        protocol,
        resolutions: allResolutions,
        builtins,
        cache: bundleCache
      })
    } finally {
      await b.close()
    }
  }

  async add(
    rootURL: { readonly href: string },
    entry: string,
    { skipModules = true, peerDependencies, abi, dryRun = false, source, pre }: AddOptions = {}
  ): Promise<Bundle> {
    let root = new URL(rootURL.href)
    if (!this.opened) await this.ready()
    if (!root.pathname.endsWith('/')) root = new URL('./', root)
    const peers = peerDependencies ? new Set(peerDependencies) : null

    const bundle = new Bundle()

    const resolutions: Record<string, Record<string, string>> = {}

    const entryURL = new URL(entry, root)

    const read = source
      ? async function (url: URL) {
          if (url.href === entryURL.href) {
            return typeof source === 'string' ? Buffer.from(source) : source
          }
          return readModule(url)
        }
      : readModule

    for await (const dependency of traverse(entryURL, { resolve: resolveBare }, read, listPrefix)) {
      if (dependency.url.href.includes('/node_modules/')) {
        if (skipModules) continue
        if (peers) {
          const moduleName = dependency.url.pathname
            .slice(dependency.url.pathname.lastIndexOf('node_modules/') + 13)
            .split('/')[0]
          if (peers.has(moduleName)) continue
        }
      }

      const p = dependency.url.pathname.replace(root.pathname, '/')
      const imps: Record<string, string> = {}
      for (const [k, v] of Object.entries(flatImports(dependency.imports))) {
        imps[k] = new URL(v).pathname.replace(root.pathname, '/')
      }

      const existing = await this.get(p)
      if (
        existing &&
        b4a.equals(
          existing.source,
          typeof dependency.source === 'string' ? Buffer.from(dependency.source) : dependency.source
        ) &&
        sameImports(existing.resolutions, imps)
      ) {
        continue
      }

      // @ts-expect-error bare-bundle 1.11 accepts Buffer bytes; its declaration only lists string.
      bundle.write(p, dependency.source)
      resolutions[p] = imps
    }

    bundle.resolutions = resolutions

    if (dryRun) return bundle

    await this._addBundle({ bundle, abi }, { pre, peerDependencies })

    return bundle
  }

  async _addBundle(
    data: { bundle: Bundle; abi?: number },
    { peerDependencies, pre }: Pick<AddOptions, 'peerDependencies' | 'pre'> = {}
  ): Promise<void> {
    if (!this.opened) await this.ready()

    let nextAbi = data.abi
    const previousManifest = await this.manifest()
    if (nextAbi && previousManifest && nextAbi <= previousManifest.abi) {
      throw new Error(`ABI ${nextAbi} <= to current ABI ${previousManifest.abi}`)
    } else if (!nextAbi) {
      nextAbi = previousManifest ? previousManifest.abi + 1 : 1
    }

    const w = this.tree.write()

    try {
      for (const f in data.bundle.files) {
        const source = data.bundle.files[f].read()

        w.tryPut(
          Buffer.from(f),
          c.encode(Entry, {
            source: pre ? await pre(source, f) : source,
            resolutions: flatImports(data.bundle.resolutions[f])
          })
        )
      }

      if (peerDependencies) {
        w.tryPut(
          Buffer.from(PEERDEPS_KEY),
          c.encode(PeerDeps, {
            packages: [...peerDependencies]
          })
        )
      }

      w.tryPut(
        Buffer.from(MANIFEST_KEY),
        c.encode(Manifest, {
          abi: nextAbi
        })
      )

      await w.flush()
    } finally {
      await w.close()
    }
  }
}

function sameImports(a: Record<string, string>, b: Record<string, string>): boolean {
  const x = Object.keys(a)
  const y = Object.keys(b)

  if (x.length !== y.length) return false

  for (let i = 0; i < x.length; i++) {
    if (a[x[i]] !== b[x[i]]) return false
  }

  return true
}

async function readModule(url: URL): Promise<Buffer | null> {
  return new Promise((resolve) => {
    fs.readFile(fileURLToPath(url), (err, data) => {
      resolve(err ? null : Buffer.from(data))
    })
  })
}

async function openDir(url: URL): Promise<fs.Dir> {
  return new Promise((resolve, reject) => {
    fs.opendir(fileURLToPath(url), (err, dir) => {
      err ? reject(err) : resolve(dir)
    })
  })
}

async function isFile(url: URL): Promise<boolean> {
  return new Promise((resolve) => {
    fs.stat(fileURLToPath(url), (err, stat) => {
      resolve(err === null && stat.isFile())
    })
  })
}

async function isDir(url: URL): Promise<boolean> {
  return new Promise((resolve) => {
    fs.stat(fileURLToPath(url), (err, stat) => {
      resolve(err === null && stat.isDirectory())
    })
  })
}

async function* listPrefix(url: URL): AsyncGenerator<URL> {
  if (await isFile(url)) return yield url

  if (url.pathname[url.pathname.length - 1] !== '/') {
    url.pathname += '/'
  }

  if (await isDir(url)) {
    for await (const entry of await openDir(url)) {
      if (entry.isDirectory()) {
        yield* listPrefix(new URL(entry.name, url))
      } else {
        yield new URL(entry.name, url)
      }
    }
  }
}

function findModule(
  cache: NonNullable<LoadOptions['cache']>,
  v: string,
  root: URL
): LoadedRelease | NodeModule {
  let s = '.'
  let prev = null

  while (true) {
    const cand = new URL(s + v, root).href
    s += '/..'
    if (prev === cand) break
    prev = cand
    const nm = cache[cand]
    if (nm) return nm
  }

  throw new Error(`failed to find module: ${v}`)
}

function flatImports(imports: Resolution): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(imports)) {
    if (typeof value === 'string') result[key] = value
  }
  return result
}
