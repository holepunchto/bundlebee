import URL from 'bare-url'
import Module from 'bare-module'
import { materialize } from './assets'
import { hostModules } from './hosts'
import { releasePath } from './records'
import { mapResolutions } from './resolutions'
import { ReleaseError } from './errors'
import type Buffer from 'bare-buffer'
import type { ReleasePin, ReleaseContents, ReleaseLoadOptions, ResolutionMap } from './types'

export async function loadModules(
  pin: ReleasePin,
  contents: ReleaseContents,
  options: ReleaseLoadOptions
): Promise<Module> {
  const { manifest, files, assets } = contents
  const target = options.platform ?? { platform: Bare.platform, arch: Bare.arch }
  const builtins = hostModules(manifest.hosts, options.hostProviders ?? {})
  const selected = new Map<string, Buffer>()
  for (const asset of manifest.assets) {
    if (
      (!asset.platform || asset.platform === target.platform) &&
      (!asset.arch || asset.arch === target.arch)
    ) {
      selected.set(asset.path, assets.get(asset.path)!)
    }
  }
  const assetURLs = await materialize(pin, selected, {
    directory: options.assetDirectory,
    target,
    signal: options.signal
  })
  const origin = 'bundle://' + pin.key + '-' + pin.length
  const href = (path: string) => new URL(path, origin).href
  const resolutions: Record<string, ResolutionMap> = {}
  const sources = new Map<string, Buffer>()
  for (const [path, file] of files) {
    if (!assets.has(path) || selected.has(path)) sources.set(href(path), file.source)
    resolutions[href(path)] = mapResolutions(file.resolutions, (path) => {
      if (path.startsWith('builtin:')) {
        if (!Object.hasOwn(builtins, path.slice(8))) {
          throw new ReleaseError('ERR_HOST_INCOMPATIBLE', 'Undeclared host module')
        }
        return path
      }
      releasePath(path)
      if (assets.has(path) && !selected.has(path)) return undefined
      return assetURLs.get(path)?.href || href(path)
    })
  }
  const cachedAssets = new Map([...assetURLs].map(([path, url]) => [url.href, selected.get(path)!]))
  const protocol = new Module.Protocol({
    exists(url) {
      return (
        sources.has(url.href) ||
        cachedAssets.has(url.href) ||
        assetURLs.has(decodeURIComponent(url.pathname))
      )
    },
    read(url) {
      return (
        sources.get(url.href) ||
        cachedAssets.get(url.href) ||
        selected.get(decodeURIComponent(url.pathname)) ||
        null
      )
    },
    resolve(url) {
      const path = decodeURIComponent(url.pathname)
      if (assets.has(path) && !selected.has(path)) {
        throw new ReleaseError(
          'ERR_ASSET_UNAVAILABLE',
          'Asset is unavailable for this platform: ' + path
        )
      }
      return assetURLs.get(path) || url
    }
  })
  if (options.signal?.aborted) {
    throw options.signal.reason ?? new ReleaseError('ABORT_ERR', 'Release operation aborted')
  }
  return Module.load(new URL(pin.entry, origin), {
    protocol,
    resolutions,
    builtins,
    cache: Object.create(null)
  })
}
