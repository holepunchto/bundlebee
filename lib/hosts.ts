import semver from 'bare-semver'
import { ReleaseError } from './errors'
import type { HostProvider, ReleaseManifest } from './types'

export function hostModules(
  requirements: ReleaseManifest['hosts'],
  providers: Readonly<Record<string, HostProvider>>
): Record<string, unknown> {
  const builtins: Record<string, unknown> = Object.create(null)
  for (const required of requirements) {
    const provider = providers[required.specifier]
    if (
      !provider ||
      !semver.Range.parse(required.version).test(semver.Version.parse(provider.version)) ||
      (required.abi && provider.abi !== required.abi) ||
      (required.platform && provider.platform !== required.platform) ||
      (required.arch && provider.arch !== required.arch)
    ) {
      throw new ReleaseError(
        'ERR_HOST_INCOMPATIBLE',
        'Missing or incompatible host provider: ' + required.specifier
      )
    }
    builtins[required.specifier] = provider.exports
  }
  return builtins
}
