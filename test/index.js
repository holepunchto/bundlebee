const { test } = require('brittle')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const createTestnet = require('hyperdht/testnet')
const Bundlebee = require('..')
const b4a = require('b4a')

test('basic', async (t) => {
  const store = new Corestore(await t.tmp())
  const b = await Bundlebee.require(
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
    const checkout = await b.findABI(1)
    const { source, resolutions } = await b.get('/entrypoint.js', checkout)
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
    t.alike(manifest, { abi: 4, trace: null })

    const checkout = await b.findABI(2)
    t.is(checkout.length, 2)

    const mod = await b.load(new URL(`file:${__dirname}/fixtures/3/`), '/entrypoint.js', checkout)
    t.is(mod.exports, 'bundle-1')
  }

  // list abis
  {
    const abis = []
    for await (const res of b.allABIs()) {
      abis.push(res)
    }
    t.is(abis.length, 4)

    t.ok(abis[0].checkout.key)
    t.ok(abis[0].checkout.length, 4)
    t.ok(abis[0].manifest.abi, 4)

    t.ok(abis[1].checkout.key)
    t.ok(abis[1].checkout.length, 3)
    t.ok(abis[1].manifest.abi, 3)

    t.ok(abis[2].checkout.key)
    t.ok(abis[2].checkout.length, 2)
    t.ok(abis[2].manifest.abi, 2)

    t.ok(abis[3].checkout.key)
    t.ok(abis[3].checkout.length, 1)
    t.ok(abis[3].manifest.abi, 1)
  }
})

test('entry stream', async (t) => {
  const store = new Corestore(await t.tmp())
  const b = await Bundlebee.require(
    store,
    './test/fixtures/0.bundle',
    './test/fixtures/1.bundle',
    './test/fixtures/2.bundle'
  )

  const entries = []

  for await (const e of b.createEntryStream()) {
    entries.push(e)
  }

  const packageJson = entries.find((e) => e.id === '/package.json')
  const entrypointJs = entries.find((e) => e.id === '/entrypoint.js')

  t.ok(packageJson)
  t.ok(packageJson.source)
  t.ok(packageJson.resolutions)

  t.ok(entrypointJs)
  t.ok(entrypointJs.source)
  t.ok(entrypointJs.resolutions)
})

test('add', async (t) => {
  const store = new Corestore(await t.tmp())
  const b = new Bundlebee(store)

  const layer = await b.add(new URL(`file:${__dirname}/fixtures/3/`), 'entrypoint.js')
  t.ok(layer)
  t.absent(layer.files['/node_modules/b4a/index.js'])

  const { source, resolutions } = await b.get('/entrypoint.js')
  t.is(
    source.toString().trim().split('\n').pop(),
    `module.exports = () => b4a.from('bundle-2').toString('utf-8')`
  )
  t.ok(resolutions['#package'].endsWith('/package.json'))
  t.ok(resolutions['b4a'].endsWith('/node_modules/b4a/index.js'))

  const mod = await b.load(new URL(`file:${__dirname}/fixtures/3/`), '/entrypoint.js')
  t.is(mod.exports(), 'bundle-2')
})

test('add - modules', async (t) => {
  const store = new Corestore(await t.tmp())
  const b = new Bundlebee(store)

  // note: node_modules will try use higher up the tree if doesn't exist
  // hence we have it checked in
  const layer = await b.add(new URL(`file:${__dirname}/fixtures/4/`), 'entrypoint.js', {
    skipModules: false
  })
  t.ok(layer)
  t.ok(Object.keys(layer.files).find((k) => k.endsWith('/node_modules/stuff/index.js')))

  const { source, resolutions } = await b.get('/entrypoint.js')
  t.is(source.toString().trim().split('\n').pop(), `module.exports = () => stuff('bundle-2')`)
  t.ok(resolutions['#package'].endsWith('/package.json'))
  t.ok(resolutions['stuff'].endsWith('/node_modules/stuff/index.js'))

  const mod = await b.load(new URL(`file:${__dirname}/fixtures/4/`), '/entrypoint.js', undefined, {
    skipModules: false
  })

  t.is(mod.exports(), 'bundle-2')
})

test('add - modules w/peer deps', async (t) => {
  const store = new Corestore(await t.tmp())
  const b = new Bundlebee(store)

  const layer = await b.add(new URL(`file:${__dirname}/fixtures/3/`), 'entrypoint.js', {
    skipModules: false,
    peerDependencies: ['b4a'] // overrides skipModules for just these modules
  })
  t.ok(layer)
  t.absent(Object.keys(layer.files).find((k) => k.endsWith('/node_modules/stuff/index.js')))

  const { source, resolutions } = await b.get('/entrypoint.js')
  t.is(
    source.toString().trim().split('\n').pop(),
    `module.exports = () => b4a.from('bundle-2').toString('utf-8')`
  )
  t.ok(resolutions['#package'].endsWith('/package.json'))
  t.ok(resolutions['b4a'].endsWith('/node_modules/b4a/index.js'))

  const mod = await b.load(new URL(`file:${__dirname}/fixtures/3/`), '/entrypoint.js', undefined, {
    skipModules: false
  })

  t.is(mod.exports(), 'bundle-2')
})

test('add - modules w/peer deps', async (t) => {
  const store = new Corestore(await t.tmp())
  const b = new Bundlebee(store)

  await b.close()

  t.ok(store.closed)
})

test('add - source string', async (t) => {
  const store = new Corestore(await t.tmp())
  const b = new Bundlebee(store)

  const src =
    "const b4a = require('b4a')\n\nmodule.exports = () => b4a.from('bundle-2').toString('utf-8')\n"

  const layer = await b.add(new URL(`file:${__dirname}/fixtures/3/`), 'entrypoint.js', {
    source: src
  })
  t.ok(layer)
  t.absent(layer.files['/node_modules/b4a/index.js'])

  const { source, resolutions } = await b.get('/entrypoint.js')
  t.is(
    source.toString().trim().split('\n').pop(),
    `module.exports = () => b4a.from('bundle-2').toString('utf-8')`
  )
  t.ok(resolutions['b4a'].endsWith('/node_modules/b4a/index.js'))

  const mod = await b.load(new URL(`file:${__dirname}/fixtures/3/`), '/entrypoint.js')
  t.is(mod.exports(), 'bundle-2')
})

test('add - source buffer', async (t) => {
  const b4a = require('b4a')
  const store = new Corestore(await t.tmp())
  const b = new Bundlebee(store)

  const src = b4a.from(
    "const b4a = require('b4a')\n\nmodule.exports = () => b4a.from('bundle-2').toString('utf-8')\n"
  )

  const layer = await b.add(new URL(`file:${__dirname}/fixtures/3/`), 'entrypoint.js', {
    source: src
  })
  t.ok(layer)

  const { source } = await b.get('/entrypoint.js')
  t.is(
    source.toString().trim().split('\n').pop(),
    `module.exports = () => b4a.from('bundle-2').toString('utf-8')`
  )

  const mod = await b.load(new URL(`file:${__dirname}/fixtures/3/`), '/entrypoint.js')
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

test('trace', async (t) => {
  const store = new Corestore(await t.tmp())
  const b = new Bundlebee(store)

  {
    const layer = await b.add(new URL(`file:${__dirname}/fixtures/3/`), 'entrypoint.js')
    t.ok(layer)

    const { trace } = await b.manifest()
    t.is(trace, null)
  }

  const expectedTrace = [
    { core: 0, seq: 1 },
    { core: 1, seq: 1 },
    { core: 1, seq: 2 },
    { core: 2, seq: 1 }
  ]

  {
    const layer = await b.add(new URL(`file:${__dirname}/fixtures/3/`), 'entrypoint.js', {
      trace: expectedTrace
    })
    t.ok(layer)

    const { trace } = await b.manifest()
    t.alike(trace, expectedTrace)
  }
})

async function createBee(t, bootstrap, key, discoveryKey) {
  const swarm = new Hyperswarm({ bootstrap })
  const store = new Corestore(await t.tmp())
  swarm.on('connection', (conn) => {
    console.log('conn', !!conn)
    store.replicate(conn)
  })

  const b = new Bundlebee(store, { key, autoUpdate: true })
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

test('obfs', async (t) => {
  function pre(source, file) {
    if (!file.endsWith('.js')) return source

    return b4a.from(b4a.toString(source).replace('bundle-', 'hello-'))
  }

  const store = new Corestore(await t.tmp())
  const b = await Bundlebee.require(
    store,
    './test/fixtures/0.bundle',
    './test/fixtures/1.bundle',
    './test/fixtures/2.bundle',
    {
      pre
    }
  )

  {
    const { source, resolutions } = await b.get('/entrypoint.js')
    t.is(source.toString().trim().split('\n').pop(), `module.exports = 'hello-2'`)
    t.alike(resolutions, Object.assign(Object.create(null), { '#package': '/package.json' }))
  }

  {
    const checkout = await b.findABI(1)
    const { source, resolutions } = await b.get('/entrypoint.js', checkout)
    t.is(source.toString().trim().split('\n').pop(), `module.exports = 'hello-0'`)
    t.alike(resolutions, Object.assign(Object.create(null), { '#package': '/package.json' }))
  }

  {
    const mod = await b.load(new URL(`file:${__dirname}/fixtures/3/`), '/entrypoint.js')
    t.ok(mod)
    t.is(mod.exports, 'hello-2')
  }

  const layer = await b.add(new URL(`file:${__dirname}/fixtures/3/`), 'entrypoint.js', {
    pre
  })
  t.ok(layer)
  t.ok(layer.toBuffer())

  // latest
  {
    const { source, resolutions } = await b.get('/entrypoint.js')
    t.is(
      source.toString().trim().split('\n').pop(),
      `module.exports = () => b4a.from('hello-2').toString('utf-8')`
    )

    t.ok(resolutions['#package'].endsWith('/package.json'))
    t.ok(resolutions['b4a'].endsWith('/node_modules/b4a/index.js'))
  }
})

test('readonly', async (t) => {
  function pre(source, file) {
    if (!file.endsWith('.js')) return source

    return b4a.from(b4a.toString(source).replace('bundle-', 'hello-'))
  }
  const dir = await t.tmp()
  const store = new Corestore(dir)
  const b = await Bundlebee.require(
    store,
    './test/fixtures/0.bundle',
    './test/fixtures/1.bundle',
    './test/fixtures/2.bundle',
    {
      pre
    }
  )

  {
    const store = new Corestore(dir, { readOnly: true })
    const b2 = new Bundlebee(store)

    const mod = await b2.load(new URL(`file:${__dirname}/fixtures/3/`), '/entrypoint.js')
    t.ok(mod)
    t.is(mod.exports, 'hello-2')
  }
})
