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

module.exports = class BundleBee extends ReadyResource {
  constructor(store) {
    super()
    this._bee = new Bee(store)
  }

  static async require(store, ...files) {
    const bundles = files.map((f) => Bundle.from(fs.readFileSync(f)))
    const b = new BundleBee(store)
    await b.ready()

    for (const bu of bundles) {
      await b._addBundle(bu)
    }

    return b
  }

  _ready() {
    return this._bee.ready()
  }

  async get(key, checkout) {
    console.log('getting', key)

    const b = checkout ? this.checkout(checkout) : this._bee

    const entry = await b.get(b4a.from(key))
    if (!entry) return null

    return c.decode(Entry, entry.value)
  }

  checkout(length) {
    if (!length) length = this._bee.head().length

    return this._bee.checkout({ length })
  }

  async _addBundle(bundle) {
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
    await w.flush()
  }

  async load(root, entry, checkout, { cache = require.cache, skipModules = true } = {}) {
    // load the entrypoint and load everything based on imports etc
    // store all into a map

    const b = this.checkout(checkout)
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

    for await (const data of b.createReadStream()) {
      const id = data.key.toString()
      const { resolutions, source } = c.decode(Entry, data.value)

      loadedData.set(id, source)

      const m = {}
      for (const [k, v] of Object.entries(resolutions)) {
        const nm = v.startsWith('/node_modules') && skipModules ? findModule(cache, v, root) : null
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

  async add(root, entry, { skipModules = true } = {}) {
    if (!root.pathname.endsWith('/')) root = new URL('./', root)

    const nodeModules = new URL('./node_modules', root)
    const bundle = new Bundle()

    const resolutions = {}

    console.log(new URL(entry, root).href)

    for await (const dependency of traverse(
      new URL(entry, root),
      { resolve: traverse.resolve.bare },
      readModule,
      listPrefix
    )) {
      if (dependency.url.href.startsWith(nodeModules.href) && skipModules) continue

      const p = dependency.url.pathname.replace(root.pathname, '/')
      const imps = {}
      for (const [k, v] of Object.entries(dependency.imports)) {
        imps[k] = new URL(v).pathname.replace(root.pathname, '/')
      }

      const existing = await this.get(p)
      if (
        existing &&
        b4a.equals(existing.source, dependency.source) &&
        sameImports(existing.imports, imps)
      ) {
        continue
      }

      bundle.write(p, dependency.source)
      resolutions[p] = imps
    }

    bundle.resolutions = resolutions

    await this._addBundle(bundle)

    return bundle
  }
}

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
