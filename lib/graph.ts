import URL from 'bare-url'
import fs from 'fs'
import traverse, { type TraverseOptions } from 'bare-module-traverse'
import resolveBare from 'bare-module-traverse/resolve/bare'
import { fileURLToPath, pathToFileURL } from 'url-file-url'
import { ReleaseError, hasCode } from './errors'
import { releasePath } from './records'
import { mapResolutions } from './resolutions'
import Buffer from 'bare-buffer'
import type { Import } from 'bare-module-lexer'
import type {
  PublishOptions,
  ReleaseGraph,
  ReleaseManifest,
  StoredModule,
  StoredAsset
} from './types'

export async function collectGraph(
  root: URL,
  entry: string,
  options: PublishOptions
): Promise<ReleaseGraph> {
  const { name, version, abi } = options
  root = new URL(root.href)
  if (!root.pathname.endsWith('/')) root = new URL('./', root)
  const realRoot =
    pathToFileURL(await fs.promises.realpath(fileURLToPath(root))).href.replace(/\/$/, '') + '/'
  async function confined(url: URL): Promise<void> {
    const actual = pathToFileURL(await fs.promises.realpath(fileURLToPath(url))).href
    if (actual !== realRoot.slice(0, -1) && !actual.startsWith(realRoot)) {
      throw new ReleaseError(
        'ERR_INVALID_RELEASE',
        'Module or asset is outside publish root: ' + url.href
      )
    }
  }
  async function readScoped(url: URL): Promise<Buffer | null> {
    try {
      await confined(url)
    } catch (err) {
      if (hasCode(err, 'ENOENT', 'ENOTDIR')) return null
      throw err
    }
    return read(url)
  }
  async function readAsset(url: URL): Promise<Buffer> {
    await confined(url)
    return Buffer.from(await fs.promises.readFile(fileURLToPath(url)))
  }
  async function* listScoped(url: URL): AsyncGenerator<URL> {
    try {
      await confined(url)
    } catch (err) {
      if (hasCode(err, 'ENOENT', 'ENOTDIR')) return
      throw err
    }
    for await (const entry of list(url)) {
      await confined(entry)
      yield entry
    }
  }
  const entryURL = new URL(entry, root)
  const entryPath = relative(root, entryURL)
  const hosts = Object.entries(options.hostRequirements ?? {}).map(([specifier, host]) => ({
    specifier,
    version: host.version,
    abi: host.abi ?? '',
    platform: host.platform ?? '',
    arch: host.arch ?? ''
  }))
  const hostNames = new Set(hosts.map((host) => host.specifier))
  const files = new Map<string, StoredModule>()
  const assets = new Map<string, Buffer>()
  const metadata = new Map<string, StoredAsset>()
  for (const item of options.assets || []) {
    const asset = typeof item === 'string' ? { path: item } : item
    const path = releasePath(asset.path.startsWith('/') ? asset.path : '/' + asset.path)
    const platform = asset.platform ?? ''
    const arch = asset.arch ?? ''
    metadata.set(path, { path, platform, arch })
    assets.set(path, await readAsset(new URL('.' + path, root)))
  }
  function* resolver(imported: Import, parent: URL, opts?: TraverseOptions) {
    if (hostNames.has(imported.specifier)) {
      yield { resolution: new URL('builtin:' + imported.specifier) }
      return 1
    }
    return yield* resolveBare(imported, parent, opts)
  }
  const iterator = traverse(
    entryURL,
    { resolve: resolver, hosts: options.platforms ? [...options.platforms] : undefined },
    readScoped,
    listScoped
  )[Symbol.asyncIterator]()
  while (true) {
    const next = await iterator.next()
    if (next.done) {
      for (const url of [...(next.value?.assets || []), ...(next.value?.addons || [])]) {
        const path = relative(root, url)
        assets.set(path, await readAsset(url))
        if (!metadata.has(path)) metadata.set(path, { path, platform: '', arch: '' })
      }
      break
    }
    const dependency = next.value
    const path = relative(root, dependency.url)
    files.set(path, {
      source:
        typeof dependency.source === 'string' ? Buffer.from(dependency.source) : dependency.source,
      resolutions: JSON.stringify(
        mapResolutions(dependency.imports, (url) =>
          url.startsWith('builtin:') ? url : relative(root, new URL(url))
        )
      )
    })
  }
  const manifest: ReleaseManifest = {
    format: 2,
    name,
    version,
    entry: entryPath,
    abi,
    files: [...files.keys()].sort(),
    assets: [...metadata.values()],
    hosts
  }
  if (!files.has(entryPath)) {
    throw new ReleaseError('ERR_INVALID_RELEASE', 'Entry was not included in the module graph')
  }
  return { manifest, files, assets }
}

function relative(root: URL, url: URL): string {
  if (url.protocol !== 'file:' || !url.href.startsWith(root.href)) {
    throw new ReleaseError(
      'ERR_INVALID_RELEASE',
      'Module or asset is outside publish root: ' + url.href
    )
  }
  return releasePath('/' + decodeURIComponent(url.href.slice(root.href.length)))
}
async function read(url: URL): Promise<Buffer | null> {
  try {
    return Buffer.from(await fs.promises.readFile(fileURLToPath(url)))
  } catch (err) {
    if (hasCode(err, 'ENOENT', 'ENOTDIR')) return null
    throw err
  }
}
async function* list(url: URL): AsyncGenerator<URL> {
  let stat
  try {
    stat = await fs.promises.stat(fileURLToPath(url))
  } catch (err) {
    if (hasCode(err, 'ENOENT')) return
    throw err
  }
  if (stat.isFile()) {
    yield url
    return
  }
  const base = url.href.endsWith('/') ? url : new URL(url.href + '/')
  for (const entry of await fs.promises.readdir(fileURLToPath(base), { withFileTypes: true })) {
    const child = new URL(encodeURIComponent(entry.name), base)
    if (entry.isDirectory()) yield* list(child)
    else yield child
  }
}
