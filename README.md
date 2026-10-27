# bundlebee

Bundle modules into [Hyperbee2](https://github.com/holepunchto/hyperbee2) for P2P sharing. Based on [bare-union-bundle](https://github.com/holepunchto/bare-union-bundle) but uses a Hyperbee2 as the backing store instead of flat bundle files, enabling replication and versioned checkouts over the network.

```
npm install bundlebee
```

For the CLI for using this on your project see: https://github.com/holepunchto/bundlebee-cli

## Immutable releases (v2)

The release APIs run on Bare 1.34 or newer. The native `bare-module` dependency is pinned to
7.1.0 to match that minimum runtime. A publisher key is the authority: package names and
versions select releases within that key, not from a global package registry.

```js
const Bundlebee = require('bundlebee')
const Corestore = require('corestore')

const store = new Corestore('./storage')
const bee = new Bundlebee(store.session())
const pin = await bee.publish(new URL('file:///path/to/package/'), 'index.js', {
  name: '@example/service',
  version: '1.2.0',
  abi: 3
})

// Persist this JSON pin wherever the application keeps its lock information.
// { format: 2, key, length, name, version, entry, abi }
const selected = await bee.resolve({ name: '@example/service', version: '^1.0.0' })
await bee.prefetch(selected)
const mod = await bee.loadRelease(pin, { offline: true })
console.log(mod.exports)
await bee.close() // closes its session, not the caller's store
await store.close()
```

`publish(root, entry, options)` traverses the complete module graph rooted inside `root`.
Dependencies must be present inside that directory or explicitly supplied by a host contract.
Module and asset realpaths must remain inside the canonical root; internal symlinks are allowed,
while links to outside files are rejected.
Each publication writes its modules, assets and manifest first, captures the exact `{ key,
length }` snapshot, then atomically adds its version, ABI and ordered version index records to
the same Bee. A failed index transaction may leave an unreachable snapshot; it cannot expose a
partial release. Versions and ABIs are immutable within a package. Concurrent publishers sharing
the writable Corestore session are serialized and duplicate bindings fail with
`ERR_RELEASE_EXISTS`. Corestore's storage lock prevents independent processes from opening the
same writable storage concurrently.

`resolve({ name, version })` supports canonical exact versions and npm-style caret, tilde,
wildcard, partial, comparator, hyphen and OR ranges through `bare-semver`. Prereleases require an
explicit matching prerelease comparator. `resolve({ name, abi })` selects an exact release
identifier. Exact version and ABI lookups are direct indexed gets. Ranges walk only that
package's SemVer-ordered index, newest first; neither path scans module entries or history.
Equal-precedence build metadata uses a deterministic lexical tie-break. Release `abi` identifies
a generation and is independent of a host module's compatibility ABI.

`Bundlebee.validateRelease(value)` validates and returns a canonical pin. `prefetch(pin)` reads
all of its manifest, modules and assets into Corestore without executing code. `loadRelease(pin)`
reads only that exact snapshot and evaluates it with a fresh module cache. Neither operation
updates the core or chooses a newer version. Replication and discovery are caller-owned; use
`bundlebee-import` for blind-peer discovery and swarm fallback. To resolve a floating selector
against remote updates, first replicate and update the core, then call `resolve`.

Set `{ offline: true }` on the constructor or an operation to prohibit waiting for unavailable
blocks. A missing local block fails with `ERR_RELEASE_NOT_CACHED`. An absent index entry returns
`ERR_RELEASE_NOT_FOUND`. `resolve`, `prefetch` and `loadRelease` accept `signal`; aborting releases
only that operation's requests and never closes the caller's store. A Bundlebee owns the store
session it receives, so pass `store.session()` when sharing a store.

### Assets and native addons

The graph's `require.asset()` files and native addons are pinned with the release. Additional
files can be included explicitly, optionally restricted to a platform and architecture:

```js
const pin = await bee.publish(root, 'index.js', {
  name: 'native-service',
  version: '1.0.0',
  abi: 1,
  assets: [{ path: '/prebuilds/darwin-arm64/service.bare', platform: 'darwin', arch: 'arm64' }],
  platforms: ['darwin-arm64', 'linux-x64']
})
const mod = await bee.loadRelease(pin, { offline: true, assetDirectory: './assets' })
```

`assets` names files relative to the publish root. Paths may begin with `/`; traversal, URL
escapes and platform-specific path separators are rejected. `platforms` selects Bare host
triplets during traversal; `loadRelease` uses the running platform/architecture by default.
Assets are materialized beneath a key/length/platform/architecture directory with temporary
files and atomic rename. Existing bytes are checked against the pinned release and repaired if
necessary. Symlink cache entries are rejected. Use an application-owned cache directory; the
cache is not an isolation boundary against other processes with write access to that directory.
Native addons execute with normal application privileges.

### Explicit host modules

```js
const pin = await bee.publish(root, 'index.js', {
  name: 'extension',
  version: '1.0.0',
  abi: 1,
  hostRequirements: { '@example/host': { version: '^2.0.0', abi: 'host-api-1' } }
})
const mod = await bee.loadRelease(pin, {
  hostProviders: {
    '@example/host': { version: '2.1.0', abi: 'host-api-1', exports: sharedHost }
  }
})
```

Only exact declared specifiers are supplied by the host; subpaths must be declared separately.
Every declared requirement must have a provider satisfying its version range and optional ABI,
platform and architecture fields. Otherwise loading fails with `ERR_HOST_INCOMPATIBLE` before
entry evaluation. The provider's `exports` object is reused by identity. The release loader
never searches ancestor caches or implicitly reuses installed modules. Providers are trusted
application declarations, not a runtime compatibility proof.

## Legacy API

The original `add`, `load`, `require`, `findABI` and `allABIs` APIs remain available for existing
bundles. Their manifests and historical ABI behavior are separate from the v2 release index.
Use the release APIs for immutable offline pins and explicit host contracts.

### Usage

```js
const Bundlebee = require('bundlebee')
const Corestore = require('corestore')

const store = new Corestore('./storage')
const b = new Bundlebee(store)

// Add a module entry point
const bundle = await b.add(new URL('file:///path/to/project/'), 'index.js')

// Load a module from the bee
const mod = await b.load(new URL('file:///path/to/project/'), '/index.js')
```

### Loading from existing bundle files

```js
const b = await Bundlebee.require(store, './0.bundle', './1.bundle')
```

### Getting existing bundles

```js
const b = new Bundlebee(store, { key: myKey })

// get remote bundle
const mod = await b.load(new URL('file:///path/to/project/'), '/index.js')

// get remote historical file using Hyperbee2 length
const { source, resolutions } = await b1.get('/entrypoint.js', 1)
```

### Checkout a specific version on init

```js
const b = new Bundlebee(store, { key, length })

// get remote bundle
const mod = await b.load(new URL('file:///path/to/project/'), '/index.js')
```

## API

#### `const b = new Bundlebee(store, [opts])`

Create a new Bundlebee instance backed by a Hyperbee2. `store` is passed directly to the `hyperbee2` constructor. `opts` configure the Hyperbee2 session. Pass a Corestore session when the caller retains ownership of its main store.

#### `const b = await Bundlebee.require(store, ...files, [opts])`

Static helper that creates a Bundlebee and imports one or more `.bundle` files (from [bare-bundle](https://github.com/holepunchto/bare-bundle)) into the bee. `opts` are forwarded to the Bundlebee constructor.

#### `await b.ready()`

Wait for the underlying Hyperbee2 to be ready. Construction is lazy. The first asynchronous method opens the underlying bee; `close()` also releases the owned store when called before first use.

#### `const entry = await b.get(key, [checkout])`

Get a single entry by its key (the file path within the bundle). Returns `{ source, resolutions }` or `null` if not found.

If `checkout` is provided it is used as the Hyperbee length for a snapshot checkout.

#### `const bee = await b.checkout(length)`

Return a Hyperbee snapshot at the given `length`. If `length` is omitted, the current head is used.

#### `const bundle = await b.add(root, entrypoint, [opts])`

Traverse `entrypoint` relative to `root` (a `file://` URL) and write all discovered modules into the bee. Returns the resulting `bare-bundle` Bundle. Only changed files are written.

`opts` includes:

```js
{
  skipModules: true // skip bundling dependencies found in `node_modules`
}
```

#### `const mod = await b.load(root, entrypoint, [checkout], [opts])`

Load `entrypoint` from the bee using `bare-module`. If `checkout` is provided, a snapshot at that Hyperbee length is used.

`opts` includes:

```js
{
  cache: require.cache, // module cache
  skipModules: true     // resolve node_modules from the local cache instead of the bundle
}
```

## How it works

Bundlebee uses `bare-module-traverse` to walk a module graph from an entry point, then stores each file's source and its resolution map into Hyperbee2 keyed by file path. On load, it reads all entries from the bee, wires up resolutions, and uses `bare-module` to evaluate the module graph. Because the backing store is a Hyperbee (built on Hypercore), the bundle can be replicated to peers and checked out at any historical version.

## Bundlebee lives on

Massive thank you to [stoney](https://www.npmjs.com/~stoney) for allowing us to use the `Bundlebee` pacakge name and take bundling P2P.

You can find the original `Bundlebee` still on [NPM](https://www.npmjs.com/package/bundlebee/v/0.1.0) or [GitHub](https://github.com/frostney/bundlebee)

## License

Apache-2.0

## Development

The handwritten implementation is strict TypeScript with erasable syntax. `npm run build` generates CommonJS output and the package entry; `require('bundlebee')` continues to return the class directly. Public declarations, including the compatibility namespace, derive from the TypeScript source. `npm test` builds and runs the Node record tests, strict consumer type check, and Bare integration suite.

`await bee.update({ signal })` refreshes the head through Hypercore without creating transport connections. Cancellation preserves `signal.reason`; the caller owns network discovery and replication. `loadRelease` and `prefetch` retain immutable snapshot behavior and never refresh the head.

`scope-lock` serializes the module snapshot and index transactions across publisher sessions. `bare-url` supplies the same URL implementation to traversal and module protocols on both runtimes.
