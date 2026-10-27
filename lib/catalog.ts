import b4a from 'b4a'
import c from 'compact-encoding'
import ID from 'hypercore-id-encoding'
import semver from 'bare-semver'
import ScopeLock from 'scope-lock'
import type Bee from 'hyperbee2'
import type Buffer from 'bare-buffer'
import type { Row } from './storage'
import type {
  PublishOptions,
  ReleaseGraph,
  ReleasePin,
  ReleaseQuery,
  ReleaseContents,
  ReleaseModule,
  OperationOptions
} from './types'
import * as records from './records'
import { ReleaseError, hasCode } from './errors'
import { Requests } from './requests'

const MANIFEST = records.MANIFEST
const pinFields: ReadonlyArray<'format' | 'name' | 'version' | 'entry' | 'abi'> = [
  'format',
  'name',
  'version',
  'entry',
  'abi'
]
const publishers = new Map<string, { lock: ScopeLock; users: number }>()

export async function publishRelease(tree: Bee, graph: ReleaseGraph): Promise<ReleasePin> {
  const key = ID.encode(tree.core.key)
  const publisher = publishers.get(key) ?? { lock: new ScopeLock(), users: 0 }
  publishers.set(key, publisher)
  publisher.users++
  await publisher.lock.lock()
  try {
    tree.update()
    return await commitRelease(tree, graph)
  } finally {
    publisher.lock.unlock()
    if (--publisher.users === 0) publishers.delete(key)
  }
}

async function commitRelease(tree: Bee, graph: ReleaseGraph): Promise<ReleasePin> {
  const { manifest, files, assets } = graph
  const { name, version, abi, entry } = manifest
  const versionKey = records.versionKey(name, version)
  const abiKey = records.abiKey(name, abi)
  if ((await tree.get(versionKey)) || (await tree.get(abiKey))) {
    throw new ReleaseError('ERR_RELEASE_EXISTS', 'Version or ABI already published')
  }
  const snapshot = tree.write()
  try {
    for (const [path, value] of files) {
      snapshot.tryPut(records.moduleKey(path), c.encode(records.Module, value))
    }
    for (const [path, bytes] of assets) snapshot.tryPut(records.assetKey(path), bytes)
    snapshot.tryPut(MANIFEST, c.encode(records.Manifest, manifest))
    await snapshot.flush()
  } finally {
    await snapshot.close()
  }

  const head = tree.head()
  const pin: ReleasePin = {
    format: 2,
    key: ID.encode(head.key),
    length: head.length,
    name,
    version,
    entry,
    abi
  }
  const index = tree.write()
  try {
    const encoded = c.encode(records.Pin, pin)
    index.tryPut(versionKey, encoded)
    index.tryPut(abiKey, encoded)
    index.tryPut(records.orderedKey(name, version), encoded)
    await index.flush()
  } finally {
    await index.close()
  }
  return pin
}

export async function resolveRelease(bee: Bee, query: ReleaseQuery): Promise<ReleasePin> {
  const requests = new Requests(bee.core, query)
  const tree = bee.snapshot({ wait: !query.offline })
  const config = requests.config
  try {
    requests.check()
    if (query.abi !== undefined) {
      const record = await tree.get(records.abiKey(query.name, query.abi), config)
      requests.check()
      if (record) return indexedPin(bee, record, query, { ordered: false })
    } else {
      let exact = false
      try {
        semver.Version.parse(query.version)
        exact = true
      } catch (error) {
        if (!hasCode(error, 'INVALID_VERSION')) throw error
      }
      if (exact) {
        const record = await tree.get(records.versionKey(query.name, query.version), config)
        requests.check()
        if (record) return indexedPin(bee, record, query, { ordered: false })
      } else {
        let range
        try {
          range = semver.Range.parse(query.version)
        } catch (cause) {
          throw new ReleaseError('ERR_INVALID_RELEASE', 'Invalid semantic version range', cause)
        }
        const prefix = records.orderedPrefix(query.name)
        for await (const record of tree.createReadStream({
          ...config,
          gte: b4a.from(prefix),
          lt: b4a.from(prefix + '\uffff'),
          reverse: true
        })) {
          requests.check()
          const pin = indexedPin(bee, record, query, { ordered: true })
          if (range.test(semver.Version.parse(pin.version))) return pin
        }
      }
    }
    requests.check()
    throw new ReleaseError(
      'ERR_RELEASE_NOT_FOUND',
      'No matching published release for ' + query.name
    )
  } catch (cause) {
    return requests.fail(cause)
  } finally {
    requests.close()
    await tree.close()
  }
}

function indexedPin(
  bee: Bee,
  record: Row,
  query: ReleaseQuery,
  options: { ordered: boolean }
): ReleasePin {
  const { ordered } = options
  const pin = records.validatePin(c.decode(records.Pin, record.value))
  const expected = ordered
    ? records.orderedKey(query.name, pin.version)
    : query.abi === undefined
      ? records.versionKey(query.name, query.version)
      : records.abiKey(query.name, query.abi)
  if (
    pin.key !== ID.encode(bee.core.key) ||
    pin.name !== query.name ||
    !b4a.equals(record.key, expected) ||
    (!ordered && query.abi === undefined && pin.version !== query.version) ||
    (query.abi !== undefined && pin.abi !== query.abi)
  ) {
    throw new ReleaseError(
      'ERR_INVALID_RELEASE',
      'Release index disagrees with its publisher or selector'
    )
  }
  return pin
}

export async function readRelease(
  bee: Bee,
  pin: ReleasePin,
  options: OperationOptions
): Promise<ReleaseContents> {
  if (ID.encode(bee.core.key) !== pin.key) {
    throw new ReleaseError('ERR_INVALID_RELEASE', 'Release key does not match this bundle')
  }
  const requests = new Requests(bee.core, options)
  const tree = bee.checkout({ key: ID.decode(pin.key), length: pin.length, wait: !options.offline })
  const config = requests.config
  try {
    requests.check()
    const record = await tree.get(MANIFEST, config)
    if (!record) {
      throw new ReleaseError('ERR_INVALID_RELEASE', 'Pinned snapshot has no release manifest')
    }
    const manifest = c.decode(records.Manifest, record.value)
    for (const field of pinFields) {
      if (manifest[field] !== pin[field]) {
        throw new ReleaseError(
          'ERR_INVALID_RELEASE',
          'Pin disagrees with release manifest: ' + field
        )
      }
    }
    const files = new Map<string, ReleaseModule>()
    for (const path of manifest.files) {
      records.releasePath(path)
      const value = await tree.get(records.moduleKey(path), config)
      if (!value) throw new ReleaseError('ERR_INVALID_RELEASE', 'Missing release module: ' + path)
      const file = c.decode(records.Module, value.value)
      files.set(path, {
        source: file.source,
        resolutions: records.parseResolutions(file.resolutions)
      })
    }
    const assets = new Map<string, Buffer>()
    for (const asset of manifest.assets) {
      records.releasePath(asset.path)
      const value = await tree.get(records.assetKey(asset.path), config)
      if (!value) {
        throw new ReleaseError('ERR_INVALID_RELEASE', 'Missing release asset: ' + asset.path)
      }
      assets.set(asset.path, value.value)
    }
    if (!files.has(pin.entry)) {
      throw new ReleaseError('ERR_INVALID_RELEASE', 'Release entry not present')
    }
    requests.check()
    return { manifest, files, assets }
  } catch (cause) {
    return requests.fail(cause)
  } finally {
    requests.close()
    await tree.close()
  }
}
