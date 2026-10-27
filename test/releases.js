const test = require('brittle')
const Corestore = require('corestore')
const AbortController = require('bare-abort-controller')
const fs = require('bare-fs')
const { pathToFileURL } = require('url-file-url')
const Bundlebee = require('..')

test('release indexes resolve exact versions, ABI generations and semantic ranges', async (t) => {
  const { bee, root } = await fixture(t)
  const versions = ['1.2.9', '1.10.0', '2.0.0-beta.2', '2.0.0-beta.10', '2.0.0', '0.2.5']
  const pins = []
  for (let i = 0; i < versions.length; i++) {
    pins.push(await bee.publish(root, 'index.js', release(versions[i], i + 1)))
  }
  t.alike(await bee.resolve({ name: '@test/example', version: '1.10.0' }), pins[1])
  t.alike(await bee.resolve({ name: '@test/example', abi: 3 }), pins[2])

  for (const [range, expected] of [
    ['^1.2.0', 1],
    ['~1.2.0', 0],
    ['>=2.0.0-beta.1 <2.0.0', 3],
    ['*', 4],
    ['^0.2.0', 5],
    ['1.x || 0.x', 1]
  ]) {
    t.alike(await bee.resolve({ name: '@test/example', version: range }), pins[expected], range)
  }
  await t.exception(bee.resolve({ name: '@test/example', version: '^3.0.0' }), /No matching/)
  t.ok(
    pins[0].length < bee.head().length,
    'pin identifies module snapshot before index transaction'
  )
})

test('immutable pinned snapshots survive newer publications and deleted modules', async (t) => {
  const { bee, root, directory } = await fixture(t, "module.exports = require('./old.js')")
  await fs.promises.writeFile(directory + '/old.js', "module.exports = 'old'")
  const old = await bee.publish(root, 'index.js', release('1.0.0', 1))
  await fs.promises.writeFile(directory + '/index.js', "module.exports = 'new'")
  await fs.promises.unlink(directory + '/old.js')
  const next = await bee.publish(root, 'index.js', release('2.0.0', 2))
  t.is((await bee.loadRelease(old, { offline: true })).exports, 'old')
  t.is((await bee.loadRelease(next, { offline: true })).exports, 'new')
  await t.exception(bee.publish(root, 'index.js', release('1.0.0', 3)), /already published/)
  await t.exception(bee.publish(root, 'index.js', release('3.0.0', 2)), /already published/)
  await t.exception(bee.loadRelease({ ...old, abi: 99 }), /disagrees/)
})

test('concurrent publication cannot bind a version or ABI twice', async (t) => {
  const { bee, root } = await fixture(t)
  const results = await Promise.allSettled([
    bee.publish(root, 'index.js', release('1.0.0', 1)),
    bee.publish(root, 'index.js', release('1.0.0', 2)),
    bee.publish(root, 'index.js', release('2.0.0', 3))
  ])
  t.is(results.filter((r) => r.status === 'fulfilled').length, 2)
  t.is(results.filter((r) => r.status === 'rejected').length, 1)
  const pin = await bee.resolve({ name: '@test/example', version: '1.0.0' })
  t.is(pin.abi, results.find((r) => r.status === 'fulfilled').value.abi)
  t.is((await bee.loadRelease(pin)).exports, 'one')
})

test('offline publisher sessions cannot rebind an existing version or ABI', async (t) => {
  const { bee, store, root } = await fixture(t)
  const first = new Bundlebee(store.session(), { key: bee.key, offline: true })
  const second = new Bundlebee(store.session(), { key: bee.key, offline: true })
  t.teardown(() => Promise.all([first.close(), second.close()]))
  await Promise.all([first.ready(), second.ready()])
  const pin = await first.publish(root, 'index.js', release('1.0.0', 1))
  await t.exception(second.publish(root, 'index.js', release('1.0.0', 2)), /already published/)
  await t.exception(second.publish(root, 'index.js', release('2.0.0', 1)), /already published/)
  t.alike(await second.resolve({ name: '@test/example', version: '1.0.0' }), pin)
  t.is((await second.loadRelease(pin)).exports, 'one')
})

test('legacy byte bundles preserve binary contents and recover from a failed transform', async (t) => {
  const { bee, root, directory } = await fixture(t)
  const bytes = Buffer.from([0, 1, 127, 128, 254, 255])
  await fs.promises.writeFile(directory + '/bytes.bin', bytes)
  await t.exception(
    bee.add(root, 'bytes.bin', {
      pre() {
        throw new Error('transform failed')
      }
    }),
    /transform failed/
  )
  const bundle = await bee.add(root, 'bytes.bin')
  t.alike([...bundle.read('/bytes.bin')], [...bytes])
  t.alike((await bee.get('/bytes.bin')).source, bytes)
})

test('host providers require explicit compatible contracts and preserve identity', async (t) => {
  const { bee, root } = await fixture(
    t,
    "module.exports = { a: require('@test/host'), b: require('@test/host') }"
  )
  const pin = await bee.publish(
    root,
    'index.js',
    release('1.0.0', 1, {
      hostRequirements: { '@test/host': { version: '^2.0.0', abi: 'interface-1' } }
    })
  )
  const value = { shared: true }
  await t.exception(bee.loadRelease(pin), /host provider/)
  await t.exception(
    bee.loadRelease(pin, {
      hostProviders: { '@test/host': { version: '3.0.0', abi: 'interface-1', exports: value } }
    }),
    /host provider/
  )
  const loaded = await bee.loadRelease(pin, {
    hostProviders: { '@test/host': { version: '2.1.0', abi: 'interface-1', exports: value } }
  })
  t.is(loaded.exports.a, value)
  t.is(loaded.exports.b, value)
})

test('assets stay pinned, materialize atomically, and reject cache symlinks', async (t) => {
  const { bee, root, directory } = await fixture(t, "module.exports = require.asset('./data.txt')")
  await fs.promises.writeFile(directory + '/data.txt', 'old asset')
  const old = await bee.publish(root, 'index.js', release('1.0.0', 1))
  await fs.promises.writeFile(directory + '/data.txt', 'new asset')
  const next = await bee.publish(root, 'index.js', release('1.1.0', 2))
  const assetDirectory = await t.tmp()
  const a = (await bee.loadRelease(old, { offline: true, assetDirectory })).exports
  const b = (await bee.loadRelease(next, { offline: true, assetDirectory })).exports
  t.is(await fs.promises.readFile(a, 'utf8'), 'old asset')
  t.is(await fs.promises.readFile(b, 'utf8'), 'new asset')
  t.not(a, b)
  const escaped = await t.tmp()
  const poisoned = await t.tmp()
  await fs.promises.symlink(
    escaped,
    poisoned + '/' + old.key + '-' + old.length + '-' + Bare.platform + '-' + Bare.arch
  )
  await t.exception(bee.loadRelease(old, { offline: true, assetDirectory: poisoned }), /symlink/)
  t.alike(await fs.promises.readdir(escaped), [])
  await t.exception(
    bee.publish(root, 'index.js', release('2.0.0', 3, { assets: ['../escape'] })),
    /Invalid release path/
  )
})

test('replicated release imports offline after peers close; cold cache fails promptly', async (t) => {
  const { bee, root } = await fixture(t)
  const pin = await bee.publish(root, 'index.js', release('1.0.0', 1))
  const store = new Corestore(await t.tmp())
  const reader = new Bundlebee(store, { key: bee.key })
  t.teardown(() => reader.close())
  const left = bee.store.replicate(true)
  const right = store.replicate(false)
  left.pipe(right).pipe(left)
  await reader.prefetch(pin)
  left.destroy()
  right.destroy()
  t.is((await reader.loadRelease(pin, { offline: true })).exports, 'one')
  const cold = new Bundlebee(new Corestore(await t.tmp()), { key: bee.key, offline: true })
  t.teardown(() => cold.close())
  try {
    await cold.loadRelease(pin, { offline: true })
    t.fail('Cold cache should fail')
  } catch (err) {
    t.is(err.code, 'ERR_RELEASE_NOT_CACHED')
  }
})

test('separate publisher sessions serialize immutable release bindings', async (t) => {
  const { bee, root } = await fixture(t)
  const other = new Bundlebee(bee.store.session(), { key: bee.key })
  await other.ready()
  t.teardown(() => other.close())
  const results = await Promise.allSettled([
    bee.publish(root, 'index.js', release('1.0.0', 1)),
    other.publish(root, 'index.js', release('1.0.0', 2))
  ])
  t.is(results.filter((r) => r.status === 'fulfilled').length, 1)
  t.is(results.filter((r) => r.status === 'rejected').length, 1)
  const next = await other.publish(root, 'index.js', release('2.0.0', 3))
  t.alike(await bee.resolve({ name: '@test/example', version: '2.0.0' }), next)
  t.is((await bee.loadRelease(next)).exports, 'one')
})

test('operation cancellation releases requests without closing the caller store', async (t) => {
  const { bee, root } = await fixture(t)
  const pin = await bee.publish(root, 'index.js', release('1.0.0', 1))
  const store = new Corestore(await t.tmp())
  t.teardown(() => store.close())
  const cold = new Bundlebee(store.session(), { key: bee.key, offline: true })
  await cold.ready()
  t.teardown(() => cold.close())
  const controller = new AbortController()
  const pending = cold.prefetch(pin, { offline: false, signal: controller.signal })
  const reason = new Error('Release read aborted')
  const timer = setTimeout(() => controller.abort(reason), 20)
  try {
    await pending
    t.fail('Expected abort')
  } catch (err) {
    t.is(err, reason)
  }
  clearTimeout(timer)
  await cold.close()
  const local = store.get({ name: 'still-open' })
  await local.ready()
  await local.append('alive')
  t.is((await local.get(0)).toString(), 'alive')
  await local.close()
  const before = bee.core.length
  await t.exception(bee.prefetch(pin, { signal: controller.signal }), /aborted/)
  t.is(bee.core.length, before)
  t.is((await bee.loadRelease(pin)).exports, 'one')
})

test('platform-selected assets exclude incompatible files and remain confined', async (t) => {
  const { bee, root, directory } = await fixture(
    t,
    "module.exports = require.asset('./native.bin')"
  )
  await fs.promises.writeFile(directory + '/native.bin', 'native payload')
  const pin = await bee.publish(
    root,
    'index.js',
    release('1.0.0', 1, {
      assets: [{ path: '/native.bin', platform: Bare.platform, arch: Bare.arch }]
    })
  )
  const assetDirectory = await t.tmp()
  const loaded = await bee.loadRelease(pin, { assetDirectory })
  t.is(await fs.promises.readFile(loaded.exports, 'utf8'), 'native payload')
  await t.exception(
    bee.loadRelease(pin, { assetDirectory, platform: { platform: 'other', arch: 'other' } }),
    /asset|module/i
  )
  t.alike((await fs.promises.readdir(assetDirectory)).length, 1)
  await fs.promises.writeFile(loaded.exports, 'corrupt')
  const repaired = await bee.loadRelease(pin, { assetDirectory })
  t.is(await fs.promises.readFile(repaired.exports, 'utf8'), 'native payload')
})

test('native addon is loaded from its pinned platform cache after source removal', async (t) => {
  const { bee, root, directory } = await fixture(
    t,
    "module.exports = require.addon('./native.bare')"
  )
  const os = require('bare-os')
  const native = require.addon.resolve('bare-os')
  await fs.promises.copyFile(native, directory + '/native.bare')
  const pin = await bee.publish(
    root,
    'index.js',
    release('1.0.0', 1, {
      assets: [{ path: '/native.bare', platform: Bare.platform, arch: Bare.arch }]
    })
  )
  await fs.promises.unlink(directory + '/native.bare')
  const loaded = await bee.loadRelease(pin, { offline: true, assetDirectory: await t.tmp() })
  t.is(loaded.exports.platform, Bare.platform)
  t.is(loaded.exports.arch, Bare.arch)
  t.is(loaded.exports.hostname(), os.hostname())
})

test('index records cannot redirect an explicit publisher authority or selector', async (t) => {
  const { bee, root } = await fixture(t)
  const pin = await bee.publish(root, 'index.js', release('1.0.0', 1))
  const records = require('../dist/lib/records')
  const Bee = require('hyperbee2')
  const publisher = new Bee(bee.store.session(), { key: bee.key })
  await publisher.ready()
  t.teardown(() => publisher.close())
  const c = require('compact-encoding')
  const key = records.versionKey(pin.name, pin.version)
  for (const change of [
    { key: require('hypercore-id-encoding').encode(require('b4a').alloc(32, 2)) },
    { name: 'other-package' },
    { version: '2.0.0' }
  ]) {
    const batch = publisher.write()
    batch.tryPut(key, c.encode(records.Pin, { ...pin, ...change }))
    await batch.flush()
    await t.exception(bee.resolve({ name: pin.name, version: pin.version }), /index disagrees/)
  }
})

test('publish confines real module and asset targets while permitting internal symlinks', async (t) => {
  const { bee, root, directory } = await fixture(t, "module.exports = require('./linked.js')")
  const external = await t.tmp()
  await fs.promises.writeFile(external + '/outside.js', "module.exports = 'outside'")
  await fs.promises.writeFile(external + '/secret.txt', 'outside-root-secret')
  await fs.promises.symlink(external + '/outside.js', directory + '/linked.js')
  await fs.promises.symlink(external + '/secret.txt', directory + '/secret.txt')
  await t.exception(bee.publish(root, 'index.js', release('1.0.0', 1)), /outside publish root/)
  await fs.promises.writeFile(
    directory + '/index.js',
    "module.exports = require.asset('./secret.txt')"
  )
  await t.exception(bee.publish(root, 'index.js', release('1.0.0', 1)), /outside publish root/)
  await fs.promises.writeFile(directory + '/index.js', "module.exports = 'safe'")
  await t.exception(
    bee.publish(root, 'index.js', release('1.0.0', 1, { assets: ['/secret.txt'] })),
    /outside publish root/
  )
  await fs.promises.unlink(directory + '/linked.js')
  await fs.promises.unlink(directory + '/secret.txt')
  await fs.promises.writeFile(directory + '/inside.js', "module.exports = 'inside'")
  await fs.promises.writeFile(directory + '/inside.txt', 'inside-asset')
  await fs.promises.symlink(directory + '/inside.js', directory + '/linked.js')
  await fs.promises.symlink(directory + '/inside.txt', directory + '/secret.txt')
  await fs.promises.writeFile(
    directory + '/index.js',
    "module.exports = { value: require('./linked.js'), asset: require.asset('./secret.txt') }"
  )
  const pin = await bee.publish(root, 'index.js', release('1.0.0', 1))
  const loaded = await bee.loadRelease(pin, { offline: true, assetDirectory: await t.tmp() })
  t.is(loaded.exports.value, 'inside')
  t.is(await fs.promises.readFile(loaded.exports.asset, 'utf8'), 'inside-asset')
})

test('construction is lazy and close before use releases the owned store', async (t) => {
  const store = new Corestore(await t.tmp())
  const bee = new Bundlebee(store)
  t.teardown(() => bee.close())

  t.is(bee.opening, null)
  await bee.close()
  t.ok(store.closed)
})

test('closing during the first open releases the owned store', async (t) => {
  const store = new Corestore(await t.tmp())
  const bee = new Bundlebee(store)
  t.teardown(() => bee.close())

  const opening = bee.ready()
  const closing = bee.close()
  await Promise.all([opening, closing])
  t.ok(bee.closed)
  t.ok(store.closed)
})

test('head refresh preserves cancellation reason and leaves the caller store usable', async (t) => {
  const { bee } = await fixture(t)
  const store = new Corestore(await t.tmp())
  const reader = new Bundlebee(store.session(), { key: bee.key, offline: true })
  t.teardown(() => reader.close())
  t.teardown(() => store.close())
  await reader.ready()
  const done = reader.core.findingPeers()
  t.teardown(done)

  const controller = new AbortController()
  const reason = new Error('Head refresh cancelled')
  const pending = reader.update({ signal: controller.signal })
  controller.abort(reason)
  try {
    await pending
    t.fail('Expected cancellation')
  } catch (error) {
    t.is(error, reason)
  }
  await reader.close()
  const local = store.get({ name: 'after-cancellation' })
  await local.append('still alive')
  t.is((await local.get(0)).toString(), 'still alive')
})

async function fixture(t, source = "module.exports = 'one'") {
  const directory = await t.tmp()
  const root = pathToFileURL(directory + '/')
  await fs.promises.writeFile(
    directory + '/package.json',
    JSON.stringify({ name: 'fixture', version: '1.0.0' })
  )
  await fs.promises.writeFile(directory + '/index.js', source)
  const store = new Corestore(await t.tmp())
  const bee = new Bundlebee(store)
  await bee.ready()
  t.teardown(() => bee.close())
  return { bee, store, root, directory }
}
const release = (version, abi, extra = {}) => ({ name: '@test/example', version, abi, ...extra })
