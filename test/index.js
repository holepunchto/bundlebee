const { test } = require('brittle')
const fs = require('fs')
const Corestore = require('corestore')
const b4a = require('b4a')
const BundleBee = require('..')

test('works', async (t) => {
  const store = new Corestore(await t.tmp())
  const b = await BundleBee.require(
    store,
    './test/fixtures/0.bundle',
    './test/fixtures/1.bundle',
    './test/fixtures/2.bundle'
  )

  // metadata entry on the bee - such as abi mapping
  // manifest = abi:25
  // can stream history to see the old ones

  {
    const { source, resolutions } = await b.get('/entrypoint.js')
    t.is(source.toString().trim(), `module.exports = 'bundle-2'`)
    t.alike(resolutions, { '#package': '/package.json' })
  }

  {
    const { source, resolutions } = await b.get('/entrypoint.js', 1)
    t.is(source.toString().trim(), `module.exports = 'bundle-0'`)
    t.alike(resolutions, { '#package': '/package.json' })
  }

  {
    const mod = await b.load(new URL(`file:${__dirname}/fixtures/3/`), '/entrypoint.js')
    t.ok(mod)
    console.log(mod)
    t.is(mod.exports, 'bundle-2')
  }

  // const b = new BundleBee(store)

  // const layer = await b.add(new URL(`file:${__dirname}/fixtures/3/`), 'entrypoint.js')
  // t.ok(layer)
  // fs.writeFileSync('./test/fixtures/3.bundle', layer.toBuffer())

  // {
  //   const mod = b.checkout(1)
  //   t.is(mod.files['/entrypoint.js'].read().toString(), `module.exports = 'bundle-1'\n`)
  // }

  // {
  //   const mod = b.checkout(2)
  //   t.is(mod.files['/entrypoint.js'].read().toString(), `module.exports = 'bundle-2'\n`)
  // }
})
