import ID from 'hypercore-id-encoding'
import semver from 'bare-semver'
import { getEncoding } from '../schema'
import { ReleaseError } from './errors'
import type { ReleasePin, ResolutionMap } from './types'
import b4a from 'b4a'

export const Pin = getEncoding('@bundlebee/release-pin')
export const Manifest = getEncoding('@bundlebee/release-manifest')
export const Module = getEncoding('@bundlebee/release-module')
export const MANIFEST = b4a.from('#v2/release')

export function moduleKey(path: string): Uint8Array {
  return b4a.from('#v2/module' + path)
}
export function assetKey(path: string): Uint8Array {
  return b4a.from('#v2/asset' + path)
}
export function versionKey(name: string, value: string): Uint8Array {
  return b4a.from(prefix(name) + 'exact/' + value)
}
export function abiKey(name: string, abi: number): Uint8Array {
  return b4a.from(prefix(name) + 'abi/' + number(abi))
}
export function orderedPrefix(name: string): string {
  return prefix(name) + 'ordered/'
}

export function orderedKey(name: string, input: string): Uint8Array {
  const v = semver.Version.parse(input)
  const pre = v.prerelease.length
    ? '0' +
      v.prerelease
        .map((p) => (/^[0-9]+$/.test(p) ? '0' + number(p.length) + p : '1' + p))
        .join('\0') +
      '\0'
    : '1'

  return b4a.from(
    orderedPrefix(name) +
      [v.major, v.minor, v.patch].map(number).join('.') +
      '/' +
      pre +
      '\0' +
      input
  )
}

export function releasePath(input: string): string {
  if (
    !input.startsWith('/') ||
    input.includes('\\') ||
    /[\0-\x1f%?#:]/.test(input) ||
    input
      .split('/')
      .slice(1)
      .some((s) => !s || s === '.' || s === '..')
  ) {
    throw new ReleaseError('ERR_INVALID_RELEASE', 'Invalid release path: ' + input)
  }
  return input
}

export function validatePin(input: unknown): ReleasePin {
  if (
    !input ||
    typeof input !== 'object' ||
    !('format' in input) ||
    input.format !== 2 ||
    !('key' in input) ||
    typeof input.key !== 'string' ||
    !('length' in input) ||
    typeof input.length !== 'number' ||
    !('abi' in input) ||
    typeof input.abi !== 'number' ||
    !('name' in input) ||
    typeof input.name !== 'string' ||
    !('version' in input) ||
    typeof input.version !== 'string' ||
    !('entry' in input) ||
    typeof input.entry !== 'string'
  ) {
    throw new ReleaseError('ERR_INVALID_RELEASE', 'Expected a format 2 release pin')
  }
  const { length, abi, name, version, entry } = input
  if (
    !Number.isSafeInteger(length) ||
    length < 1 ||
    !Number.isSafeInteger(abi) ||
    abi < 1 ||
    !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)
  ) {
    throw new ReleaseError('ERR_INVALID_RELEASE', 'Invalid release identity or snapshot')
  }
  releasePath(entry)
  return {
    format: 2,
    key: canonicalKey(input.key),
    length,
    abi,
    name,
    version: canonicalVersion(version),
    entry
  }
}

export function parseResolutions(json: string): ResolutionMap {
  const value: unknown = JSON.parse(json)
  return resolutionObject(value)
}

function resolutionObject(value: unknown): ResolutionMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReleaseError('ERR_INVALID_RELEASE', 'Invalid module resolution map')
  }
  const result: ResolutionMap = {}
  for (const [key, child] of Object.entries(value)) {
    Object.defineProperty(result, key, {
      value: resolution(child),
      enumerable: true
    })
  }
  return result
}

function resolution(value: unknown): import('./types').Resolution {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(resolution)
  return resolutionObject(value)
}

function canonicalKey(key: string): string {
  try {
    return ID.encode(ID.decode(key))
  } catch (cause) {
    throw new ReleaseError('ERR_INVALID_RELEASE', 'Invalid release key', cause)
  }
}

function canonicalVersion(version: string): string {
  try {
    const parsed = semver.Version.parse(version)
    if (
      parsed.toString() !== version ||
      [parsed.major, parsed.minor, parsed.patch].some((n) => !Number.isSafeInteger(n) || n < 0)
    ) {
      throw new Error('Noncanonical version')
    }
    return version
  } catch (cause) {
    throw new ReleaseError(
      'ERR_INVALID_RELEASE',
      'Invalid exact semantic version: ' + version,
      cause
    )
  }
}

function number(n: number): string {
  return n.toString(16).padStart(14, '0')
}
function prefix(name: string): string {
  return '#v2/package/' + encodeURIComponent(name) + '/'
}
