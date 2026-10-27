const test = require('brittle')
const b4a = require('b4a')
const { Version } = require('bare-semver')
const records = require('../dist/lib/records')

test('release index bytes follow SemVer ordering for numeric, textual and prefix prereleases', (t) => {
  const versions = []
  for (const base of ['0.0.0', '0.1.0', '1.0.0', '1.2.9', '1.10.0', '2.0.0']) {
    for (const pre of [
      '',
      '-0',
      '-1',
      '-2',
      '-10',
      '-999999999999999999999',
      '-alpha',
      '-alpha.0',
      '-alpha.1',
      '-alpha.10',
      '-alpha-beta',
      '-beta',
      '-beta.1',
      '-beta.10',
      '-rc.0'
    ]) {
      versions.push(base + pre)
    }
  }
  const expected = versions
    .slice()
    .sort((a, b) => Version.compare(Version.parse(a), Version.parse(b)))
  const actual = versions
    .slice()
    .sort((a, b) => b4a.compare(records.orderedKey('example', a), records.orderedKey('example', b)))
  t.alike(actual, expected)
  t.ok(
    b4a.compare(
      records.orderedKey('example', '1.0.0+a'),
      records.orderedKey('example', '1.0.0+b')
    ) < 0,
    'build metadata has deterministic lexical tie-break'
  )
  t.absent(
    records
      .orderedKey('example-other', '1.0.0')
      .toString()
      .startsWith(records.orderedPrefix('example')),
    'package index prefixes cannot overlap'
  )
})

test('release pins validate authority, canonical versions and confined entry paths', (t) => {
  const pin = {
    format: 2,
    key: require('hypercore-id-encoding').encode(b4a.alloc(32, 1)),
    length: 3,
    name: '@test/example',
    version: '1.0.0',
    entry: '/index.js',
    abi: 1
  }
  t.alike(records.validatePin(pin), pin)
  for (const change of [
    { key: 'bad' },
    { length: 0 },
    { length: Number.MAX_SAFE_INTEGER + 1 },
    { abi: -1 },
    { version: '^1' },
    { name: '../bad' },
    { entry: '/../outside.js' },
    { entry: '/a%2fb' },
    { entry: '/a\\b' }
  ]) {
    t.exception(() => records.validatePin({ ...pin, ...change }), { code: 'ERR_INVALID_RELEASE' })
  }
})
