const traverse = require('bare-module-traverse')
const Bundle = require('bare-bundle')
const Module = require('bare-module')
const { fileURLToPath } = require('url-file-url')
const fs = require('fs')
const b4a = require('b4a')
const ReadyResource = require('ready-resource')
const Bee = require('hyperbee2')
const c = require('compact-encoding')
const { getEncoding } = require('./schema')

const Entry = getEncoding('@hyperbundle/entry')
const Manifest = getEncoding('@hyperbundle/manifest')
const PeerDeps = getEncoding('@hyperbundle/peer-deps')

const MANIFEST_KEY_VALUE = '#manifest'
const MANIFEST_KEY = b4a.from(MANIFEST_KEY_VALUE)
const PEERDEPS_KEY_VALUE = '#peer-deps'
const PEERDEPS_KEY = b4a.from(PEERDEPS_KEY_VALUE)

// TODO
// peer deps

module.exports = class Hyperbundle extends ReadyResource {
  constructor(store, opts = {}) {
    super()
    this._bee = new Bee(store, opts)

    this.ready().catch(noop)
  }

  static async require(store, ...files) {
    const opts =
      files.length && typeof files[files.length - 1] === 'object' ? files.pop() : undefined

    const bundles = files.map((f) => Bundle.from(fs.readFileSync(f)))
    const b = new Hyperbundle(store, opts)

    for (const bu of bundles) {
      await b._addBundle(bu)
    }

    return b
  }

  get core() {
    return this._bee.core
  }

  head() {
    return this._bee.head()
  }

  get key() {
    return this._bee.core.key
  }

  get discoveryKey() {
    return this._bee.core.discoveryKey
  }

  _open() {
    return this._bee.ready()
  }

  async manifest(checkout) {
    if (!this.opened) await this.ready()

    const b = checkout ? await this.checkout(checkout) : this._bee

    const entry = await b.get(MANIFEST_KEY)
    if (!entry) return null

    return c.decode(Manifest, entry.value)
  }

  async peerDependencies(checkout) {
    if (!this.opened) await this.ready()

    const b = checkout ? await this.checkout(checkout) : this._bee

    const entry = await b.get(b4a.from('#peer-deps'))
    if (!entry) return null

    const { packages } = c.decode(PeerDeps, entry.value)

    return new Set(packages)
  }

  async get(key, checkout) {
    if (!this.opened) await this.ready()

    const b = checkout ? await this.checkout(checkout) : this._bee

    const entry = await b.get(b4a.from(key))
    if (!entry) return null

    return c.decode(Entry, entry.value)
  }

  async findABI(abi) {
    for await (const d of this._bee.createChangesStream({
      gt: MANIFEST_KEY,
      lt: MANIFEST_KEY
    })) {
      const record = d.batch[0].keys?.find((k) => k.key.toString() === MANIFEST_KEY_VALUE)
      if (!record) continue

      // always last in the batch
      const manifest = c.decode(Manifest, record.value)
      if (manifest.abi !== abi) continue

      return d.head.length
    }
  }

  async checkout(length) {
    if (!this.opened) await this.ready()
    if (!length) length = this._bee.head().length

    return this._bee.checkout({ length })
  }

  async load(root, entry, checkout, { cache = require.cache, skipModules = true } = {}) {
    if (!this.opened) await this.ready()

    const b = await this.checkout(checkout)
    const loadedData = new Map()

    const protocol = new Module.Protocol({
      exists(url) {
        return true
      },
      read(url) {
        const p = url.pathname
        return loadedData.get(p)
      }
    })

    const bundleCache = Object.create(null)
    const allResolutions = Object.create(null)

    const peerDeps = await this.peerDependencies(checkout)

    for await (const data of b.createReadStream()) {
      const id = data.key.toString()
      if (id === MANIFEST_KEY_VALUE || id === PEERDEPS_KEY_VALUE) continue

      const { resolutions, source } = c.decode(Entry, data.value)

      loadedData.set(id, source)

      const m = {}
      for (const [k, v] of Object.entries(resolutions)) {
        const skip = peerDeps && peerDeps.has(k)
        const nm =
          (v.startsWith('/node_modules') && skipModules) || skip ? findModule(cache, v, root) : null
        if (nm) {
          m[k] = 'bundle://host' + v
          bundleCache[m[k]] = nm
        } else {
          m[k] = 'bundle://layer' + v
        }
      }
      allResolutions['bundle://layer' + id] = m
    }

    return Module.load(new URL(entry, 'bundle://layer/'), {
      protocol,
      resolutions: allResolutions,
      cache: bundleCache
    })
  }

  async add(root, entry, { skipModules = true, peerDependencies } = {}) {
    if (!this.opened) await this.ready()
    if (!root.pathname.endsWith('/')) root = new URL('./', root)
    if (peerDependencies) peerDependencies = new Set(peerDependencies)

    const nodeModules = new URL('./node_modules', root)
    const bundle = new Bundle()

    const resolutions = {}

    for await (const dependency of traverse(
      new URL(entry, root),
      { resolve: traverse.resolve.bare },
      readModule,
      listPrefix
    )) {
      if (dependency.url.href.startsWith(nodeModules.href)) {
        if (skipModules) continue
        if (peerDependencies) {
          const moduleName = dependency.url.pathname
            .replace(root.pathname + 'node_modules/', '')
            .split('/')[0]
          if (peerDependencies.has(moduleName)) continue
        }
      }

      const p = dependency.url.pathname.replace(root.pathname, '/')
      const imps = {}
      for (const [k, v] of Object.entries(dependency.imports)) {
        imps[k] = new URL(v).pathname.replace(root.pathname, '/')
      }

      const existing = await this.get(p)
      if (
        existing &&
        b4a.equals(existing.source, dependency.source) &&
        sameImports(existing.resolutions, imps)
      ) {
        continue
      }

      bundle.write(p, dependency.source)
      resolutions[p] = imps
    }

    bundle.resolutions = resolutions

    await this._addBundle(bundle, peerDependencies)

    return bundle
  }

  async _addBundle(bundle, peerDependencies) {
    if (!this.opened) await this.ready()

    const w = this._bee.write()
    for (const f in bundle.files) {
      // TODO: make a schema for resolutions value
      // source + resolutions map

      w.tryPut(
        b4a.from(f),
        c.encode(Entry, {
          source: bundle.files[f].read(),
          resolutions: bundle.resolutions[f]
        })
      )
    }

    const previousManifest = await this.manifest()
    const nextAbi = previousManifest ? previousManifest.abi + 1 : 1

    if (peerDependencies) {
      w.tryPut(
        b4a.from(PEERDEPS_KEY),
        c.encode(PeerDeps, {
          packages: [...peerDependencies]
        })
      )
    }

    w.tryPut(
      b4a.from(MANIFEST_KEY),
      c.encode(Manifest, {
        abi: nextAbi
      })
    )

    await w.flush()
  }
}

function noop() {}

function sameImports(a, b) {
  const x = Object.keys(a)
  const y = Object.keys(b)

  if (x.length !== y.length) return false

  for (let i = 0; i < x.length; i++) {
    if (a[x[i]] !== b[x[i]]) return false
  }

  return true
}

async function readModule(url) {
  return new Promise((resolve) => {
    fs.readFile(fileURLToPath(url), (err, data) => {
      resolve(err ? null : data)
    })
  })
}

async function openDir(url) {
  return new Promise((resolve, reject) => {
    fs.opendir(fileURLToPath(url), (err, dir) => {
      err ? reject(err) : resolve(dir)
    })
  })
}

async function isFile(url) {
  return new Promise((resolve) => {
    fs.stat(fileURLToPath(url), (err, stat) => {
      resolve(err === null && stat.isFile())
    })
  })
}

async function isDir(url) {
  return new Promise((resolve) => {
    fs.stat(fileURLToPath(url), (err, stat) => {
      resolve(err === null && stat.isDirectory())
    })
  })
}

async function* listPrefix(url) {
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

function findModule(cache, v, root) {
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

  return null
}
