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

const Entry = getEncoding('@bundlebee/entry')
const Manifest = getEncoding('@bundlebee/manifest')
const PeerDeps = getEncoding('@bundlebee/peer-deps')

const MANIFEST_KEY_VALUE = '#manifest'
const MANIFEST_KEY = b4a.from(MANIFEST_KEY_VALUE)
const PEERDEPS_KEY_VALUE = '#peer-deps'
const PEERDEPS_KEY = b4a.from(PEERDEPS_KEY_VALUE)

// TODO
// peer deps

module.exports = class Bundlebee extends ReadyResource {
  constructor(store, opts = {}) {
    super()
    this._bee = new Bee(store, { autoUpdate: true, ...opts })

    this.ready().catch(noop)
  }

  static async require(store, ...files) {
    const opts =
      files.length &&
      typeof files[files.length - 1] === 'object' &&
      !('bundle' in files[files.length - 1])
        ? files.pop()
        : undefined

    const b = new Bundlebee(store, opts)
    const manifest = await b.manifest()

    // skip requires an existing manifest
    const skipExistingABIs = opts && !!opts.skipExistingABIs && !!manifest
    const peerDependencies = opts?.peerDependencies

    // Early exit
    const lastAbi =
      files.length && typeof files[files.length - 1] === 'object'
        ? files[files.length - 1].abi || 0
        : 0
    if (skipExistingABIs && lastAbi <= manifest.abi) return b

    const bundles = files.reduce((all, f) => {
      const data = typeof f === 'object' ? f : { bundle: f, abi: 0 }
      if (skipExistingABIs && data.abi <= manifest.abi) return all

      all.push({
        ...data,
        bundle: Bundlebee.bundleFrom(data.bundle)
      })

      return all
    }, [])

    for (const bu of bundles) {
      await b._addBundle(bu, peerDependencies)
    }

    return b
  }

  static bundleFrom(f) {
    if (f.endsWith('.js')) {
      const bundle = require(f)
      return bundle
    }

    return Bundle.from(fs.readFileSync(f))
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

  async *createEntryStream(checkout) {
    const b = checkout ? await this.checkout(checkout) : this._bee

    for await (const data of b.createReadStream()) {
      const id = data.key.toString()
      if (id === MANIFEST_KEY_VALUE || id === PEERDEPS_KEY_VALUE) continue
      const entry = c.decode(Entry, data.value)
      yield { ...entry, id }
    }
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
    for await (const d of this._bee.createChangesStream()) {
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
  }

  async checkout(checkout) {
    if (!this.opened) await this.ready()

    return this._bee.checkout(checkout)
  }

  async load(root, entry, checkout, { cache = require.cache, skipModules = true } = {}) {
    if (!this.opened) await this.ready()
    if (!(await this.get(entry, checkout))) throw new Error(`${entry} not found`)

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

  async add(root, entry, { skipModules = true, peerDependencies, abi, dryRun = false } = {}) {
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
      if (dependency.url.href.includes('/node_modules/')) {
        if (skipModules) continue
        if (peerDependencies) {
          const moduleName = dependency.url.pathname
            .slice(dependency.url.pathname.lastIndexOf('node_modules/') + 13)
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

    if (dryRun) return bundle

    await this._addBundle({ bundle, abi }, peerDependencies)

    return bundle
  }

  async _addBundle(data, peerDependencies) {
    if (!this.opened) await this.ready()

    let nextAbi = data.abi
    const previousManifest = await this.manifest()
    if (nextAbi && previousManifest && nextAbi <= previousManifest.abi) {
      throw new Error(`ABI ${nextAbi} <= to current ABI ${previousManifest.abi}`)
    } else if (!nextAbi) {
      nextAbi = previousManifest ? previousManifest.abi + 1 : 1
    }

    const w = this._bee.write()
    for (const f in data.bundle.files) {
      w.tryPut(
        b4a.from(f),
        c.encode(Entry, {
          source: data.bundle.files[f].read(),
          resolutions: data.bundle.resolutions[f]
        })
      )
    }

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

  throw new Error(`failed to find module: ${v}`)
}
