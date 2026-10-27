import Bundlebee = require('../../')

declare const store: import('../../dist/lib/storage').Store
const bee = new Bundlebee(store, { name: 'qvac-provider-python', offline: true })
const options: Bundlebee.PublishOptions = {
  name: '@test/module',
  version: '1.2.3',
  abi: 1,
  assets: [{ path: '/native.bin', platform: 'linux', arch: 'x64' }],
  hostRequirements: { host: { version: '^1.0.0', abi: 'interface-1' } }
}
async function release(): Promise<Bundlebee.ReleasePin> {
  const published = await bee.publish(new URL('file:///tmp/package/'), 'index.js', options)
  const pin = Bundlebee.validateRelease(published)
  await bee.prefetch(pin, { offline: true, signal: new AbortController().signal })
  const loaded = await bee.loadRelease(pin, {
    assetDirectory: '/tmp/assets',
    hostProviders: { host: { version: '1.2.0', abi: 'interface-1', exports: {} } }
  })
  const value: unknown = loaded.exports
  void value
  return bee.resolve({ name: pin.name, abi: pin.abi })
}
void release
// @ts-expect-error exactly one selector is required
bee.resolve({ name: '@test/module', version: '^1', abi: 1 })
// @ts-expect-error host versions are mandatory
const provider: Bundlebee.HostProvider = { exports: {} }
void provider
