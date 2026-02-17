# bundlebee

Bundle modules into [Hyperbee2](https://github.com/holepunchto/hyperbee2) for P2P sharing. Based on [bare-union-bundle](https://github.com/holepunchto/bare-union-bundle) but uses a Hyperbee2 as the backing store instead of flat bundle files, enabling replication and versioned checkouts over the network.

```
npm install bundlebee
```

## Usage

```js
const BundleBee = require('bundlebee')
const Corestore = require('corestore')

const store = new Corestore('./storage')

const b = new BundleBee(store)
await b.ready()

// Add a module entry point
const bundle = await b.add(new URL('file:///path/to/project/'), 'index.js')

// Load a module from the bee
const mod = await b.load(new URL('file:///path/to/project/'), '/index.js')
```

### Loading from existing bundle files

```js
const b = await BundleBee.require(store, './0.bundle', './1.bundle')
```

## API

#### `const b = new BundleBee(store, [opts])`

Create a new BundleBee instance backed by a Hyperbee2. `store` is passed directly to the `hyperbee2` constructor. `opts` are forwarded to Hyperbee2.

#### `const b = await BundleBee.require(store, ...files, [opts])`

Static helper that creates a BundleBee and imports one or more `.bundle` files (from [bare-bundle](https://github.com/holepunchto/bare-bundle)) into the bee. `opts` are forwarded to the BundleBee constructor.

#### `await b.ready()`

Wait for the underlying Hyperbee2 to be ready. This is done automatically on init and use of any async functions.

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

BundleBee uses `bare-module-traverse` to walk a module graph from an entry point, then stores each file's source and its resolution map into Hyperbee2 keyed by file path. On load, it reads all entries from the bee, wires up resolutions, and uses `bare-module` to evaluate the module graph. Because the backing store is a Hyperbee (built on Hypercore), the bundle can be replicated to peers and checked out at any historical version.

## License

Apache-2.0
