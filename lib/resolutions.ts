import type { Resolution, ResolutionMap } from './types'

export function mapResolutions(
  value: ResolutionMap,
  map: (path: string) => string | undefined
): ResolutionMap {
  const result: ResolutionMap = {}
  for (const [key, child] of Object.entries(value)) {
    const resolution = mapResolution(child, map)
    if (resolution !== undefined) {
      Object.defineProperty(result, key, { value: resolution, enumerable: true })
    }
  }
  return result
}

function mapResolution(
  value: Resolution,
  map: (path: string) => string | undefined
): Resolution | undefined {
  if (typeof value === 'string') return map(value)
  if (Array.isArray(value)) {
    const result: Resolution[] = []
    for (const child of value) {
      const resolution = mapResolution(child, map)
      if (resolution !== undefined) result.push(resolution)
    }
    return result
  }
  return mapResolutions(value, map)
}
