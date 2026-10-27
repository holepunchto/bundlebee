const test = require('brittle')
const { spawnSync } = require('node:child_process')
const runtime = require('bare-runtime')

test('first package import can publish and load in a fresh Bare process', (t) => {
  const result = spawnSync(runtime(), [require.resolve('./fixtures/first-import.cjs')], {
    encoding: 'utf8',
    timeout: 30000
  })
  t.is(result.status, 0, result.stderr || result.error?.message || 'fresh process completed')
  t.is(result.stdout.trim(), 'published and loaded')
})
