const { test } = require('brittle')
const fs = require('fs')
const Corestore = require('corestore')
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
    console.log(mod)
    t.is(mod.exports, 'bundle-2')
  }

  const layer = await b.add(new URL(`file:${__dirname}/fixtures/3/`), 'entrypoint.js')
  t.ok(layer)
  t.ok(layer.toBuffer())
})

test('sharing', async (t) => {
  const store = new Corestore(await t.tmp())
  const b1 = new BundleBee(store)

  const layer = await b1.add(new URL(`file:${__dirname}/fixtures/3/`), 'entrypoint.js')
  t.ok(layer)

  {
    const { source, resolutions } = await b1.get('/entrypoint.js')
    t.is(source.toString().trim(), `module.exports = 'bundle-2'`)
    t.alike(resolutions, Object.assign(Object.create(null), { '#package': '/package.json' }))
  }

  const b2 = new BundleBee(store, { key: b1.key })

  {
    const { source, resolutions } = await b2.get('/entrypoint.js')
    t.is(source.toString().trim(), `module.exports = 'bundle-2'`)
    t.alike(
      resolutions,
      Object.assign(Object.create(null), { '#package': '/package.json' }),
      'b2 works'
    )
  }
})

test('shared history', async (t) => {
  const store = new Corestore(await t.tmp())
  const b1 = await BundleBee.require(
    store,
    './test/fixtures/0.bundle',
    './test/fixtures/1.bundle',
    './test/fixtures/2.bundle'
  )

  {
    const { source, resolutions } = await b1.get('/entrypoint.js')
    t.is(source.toString().trim(), `module.exports = 'bundle-2'`)
    t.alike(resolutions, Object.assign(Object.create(null), { '#package': '/package.json' }))
  }

  const b2 = new BundleBee(store, { key: b1.key })

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
