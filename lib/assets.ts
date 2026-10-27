import URL from 'bare-url'
import fs from 'fs'
import { pathToFileURL, fileURLToPath } from 'url-file-url'
import b4a from 'b4a'
import crypto from 'hypercore-crypto'
import { ReleaseError, hasCode } from './errors'
import type { ReleasePin, Platform, Signal } from './types'
import type Buffer from 'bare-buffer'

export async function materialize(
  pin: ReleasePin,
  assets: ReadonlyMap<string, Buffer>,
  options: { directory?: string | { readonly href: string }; target: Platform; signal?: Signal }
): Promise<Map<string, URL>> {
  const { directory, target, signal } = options
  const urls = new Map<string, URL>()
  if (assets.size === 0) return urls
  if (!directory) {
    throw new ReleaseError(
      'ERR_ASSET_DIRECTORY_REQUIRED',
      'An assetDirectory is required for release assets'
    )
  }
  const rootPath =
    typeof directory === 'object' && directory !== null
      ? fileURLToPath(new URL(directory.href))
      : directory
  await fs.promises.mkdir(rootPath, { recursive: true })
  const realRoot = await fs.promises.realpath(rootPath)
  const root = pathToFileURL(realRoot + '/')
  const folder = `${pin.key}-${pin.length}-${target.platform}-${target.arch}/`
  const base = new URL(folder, root)
  await ensureDirectory(base, root)
  for (const [path, bytes] of assets) {
    if (signal?.aborted) {
      throw signal.reason ?? new ReleaseError('ABORT_ERR', 'Release operation aborted')
    }
    const url = new URL('.' + path, base)
    await ensureDirectory(new URL('./', url), root)
    const filename = fileURLToPath(url)
    try {
      const stat = await fs.promises.lstat(filename)
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new ReleaseError('ERR_ASSET_PATH', 'Asset cache path is not a regular file')
      }
      const existing = await fs.promises.readFile(filename)
      if (b4a.equals(existing, bytes)) {
        urls.set(path, url)
        continue
      }
    } catch (err) {
      if (!hasCode(err, 'ENOENT')) throw err
    }
    const temporary = filename + '.' + b4a.toString(crypto.randomBytes(16), 'hex') + '.tmp'
    try {
      await fs.promises.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
      await fs.promises.rename(temporary, filename)
    } finally {
      await fs.promises.unlink(temporary).catch((err) => {
        if (!hasCode(err, 'ENOENT')) throw err
      })
    }
    urls.set(path, url)
  }
  return urls
}

async function ensureDirectory(url: URL, root: URL): Promise<void> {
  if (!url.href.startsWith(root.href)) {
    throw new ReleaseError('ERR_ASSET_PATH', 'Asset path escapes cache directory')
  }
  let current = root
  for (const segment of url.href.slice(root.href.length).split('/').filter(Boolean)) {
    current = new URL(segment + '/', current)
    const filename = fileURLToPath(current).replace(/[\\/]$/, '')
    try {
      await fs.promises.mkdir(filename)
    } catch (err) {
      if (!hasCode(err, 'EEXIST')) throw err
    }
    const stat = await fs.promises.lstat(filename)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new ReleaseError('ERR_ASSET_PATH', 'Asset cache contains a symlink or non-directory')
    }
  }
}
