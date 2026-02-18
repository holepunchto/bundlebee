const { test } = require('brittle')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const createTestnet = require('hyperdht/testnet')
const BundleBee = require('..')

test('basic', async (t) => {
  const store = new Corestore(await t.tmp())
  const b = await BundleBee.require(
    store,
    './test/fixtures/0.bundle',
    './test/fixtures/1.bundle',
    './test/fixtures/2.bundle'
  )

  {
    const { source, resolutions } = await b.get('/entrypoint.js')
    t.is(source.toString().trim(), `module.exports = 'bundle-2'`)
    t.alike(resolutions, Object.assign(Object.create(null), { '#package': '/package.json' }))
  }

  {
    const { source, resolutions } = await b.get('/entrypoint.js', 1)
    t.is(source.toString().trim(), `module.exports = 'bundle-0'`)
    t.alike(resolutions, Object.assign(Object.create(null), { '#package': '/package.json' }))
  }

  {
    const mod = await b.load(new URL(`file:${__dirname}/fixtures/3/`), '/entrypoint.js')
    t.ok(mod)
    t.is(mod.exports, 'bundle-2')
  }

  const layer = await b.add(new URL(`file:${__dirname}/fixtures/3/`), 'entrypoint.js')
  t.ok(layer)
  t.ok(layer.toBuffer())

  // manifest
  {
    const manifest = await b.manifest()
    t.alike(manifest, { abi: 4 })

    const length = await b.findABI(2)
    t.is(length, 2)

    const mod = await b.load(new URL(`file:${__dirname}/fixtures/3/`), '/entrypoint.js', length)
    t.is(mod.exports, 'bundle-1')
  }
})

test('add', async (t) => {
  const store = new Corestore(await t.tmp())
  const b = new BundleBee(store)

  const layer = await b.add(new URL(`file:${__dirname}/fixtures/3/`), 'entrypoint.js')
  t.ok(layer)
  t.absent(layer.files['/node_modules/b4a/index.js'])

  const { source, resolutions } = await b.get('/entrypoint.js')
  t.is(
    source.toString().trim().split('\n').pop(),
    `module.exports = () => b4a.from('bundle-2').toString('utf-8')`
  )
  t.alike(
    resolutions,
    Object.assign(Object.create(null), {
      '#package': '/package.json',
      b4a: '/node_modules/b4a/index.js'
    })
  )

  const mod = await b.load(new URL(`file:${__dirname}/fixtures/3/`), '/entrypoint.js')
  t.is(mod.exports(), 'bundle-2')
})

test('add - modules', async (t) => {
  const store = new Corestore(await t.tmp())
  const b = new BundleBee(store)

  const layer = await b.add(new URL(`file:${__dirname}/fixtures/3/`), 'entrypoint.js', {
    skipModules: false
  })
  t.ok(layer)
  t.ok(layer.files['/node_modules/b4a/index.js'])

  const { source, resolutions } = await b.get('/entrypoint.js')
  t.is(
    source.toString().trim().split('\n').pop(),
    `module.exports = () => b4a.from('bundle-2').toString('utf-8')`
  )
  t.alike(
    resolutions,
    Object.assign(Object.create(null), {
      '#package': '/package.json',
      b4a: '/node_modules/b4a/index.js'
    })
  )

  const mod = await b.load(new URL(`file:${__dirname}/fixtures/3/`), '/entrypoint.js', undefined, {
    skipModules: false
  })

  t.is(mod.exports(), 'bundle-2')
})

test('add - modules w/peer deps', async (t) => {
  const store = new Corestore(await t.tmp())
  const b = new BundleBee(store)

  const layer = await b.add(new URL(`file:${__dirname}/fixtures/3/`), 'entrypoint.js', {
    skipModules: false,
    peerDependencies: ['b4a']
  })
  t.ok(layer)
  t.absent(layer.files['/node_modules/b4a/index.js'])

  const { source, resolutions } = await b.get('/entrypoint.js')
  t.is(
    source.toString().trim().split('\n').pop(),
    `module.exports = () => b4a.from('bundle-2').toString('utf-8')`
  )
  t.alike(
    resolutions,
    Object.assign(Object.create(null), {
      '#package': '/package.json',
      b4a: '/node_modules/b4a/index.js'
    })
  )

  const mod = await b.load(new URL(`file:${__dirname}/fixtures/3/`), '/entrypoint.js', undefined, {
    skipModules: false
  })

  t.is(mod.exports(), 'bundle-2')
})

test.skip('sharing', async (t) => {
  const { bootstrap } = await createTestnet(t)
  const b1 = await createBee(t, bootstrap)

  const layer = await b1.add(new URL(`file:${__dirname}/fixtures/3/`), 'entrypoint.js')
  t.ok(layer)

  const b2 = await createBee(t, bootstrap, b1.key, b1.discoveryKey)

  if (b2.core.length === 0) {
    throw new Error('Could not connect to the writer peer')
  }

  {
    const { source, resolutions } = await b2.get('/entrypoint.js')
    t.is(source.toString().trim(), `module.exports = 'bundle-2'`)
    t.alike(
      resolutions,
      Object.assign(Object.create(null), { '#package': '/package.json' }),
      'b2 works'
    )
  }

  {
    const { source, resolutions } = await b2.get('/entrypoint.js', 1)
    t.is(source.toString().trim(), `module.exports = 'bundle-0'`)
    t.alike(
      resolutions,
      Object.assign(Object.create(null), { '#package': '/package.json' }),
      'b2 works'
    )
  }
})

async function createBee(t, bootstrap, key, discoveryKey) {
  const swarm = new Hyperswarm({ bootstrap })
  const store = new Corestore(await t.tmp())
  swarm.on('connection', (conn) => {
    console.log('conn', !!conn)
    store.replicate(conn)
  })

  const b = new BundleBee(store, { key, autoUpdate: true })
  await b.ready()

  t.teardown(() => {
    swarm.destroy()
    b.close()
  })

  const discovery = swarm.join(discoveryKey || b.discoveryKey)
  await discovery.flushed()

  if (discoveryKey) {
    await swarm.flush()
    await b.core.update()
  }

  return b
}
