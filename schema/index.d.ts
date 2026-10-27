import type { Encoder } from 'compact-encoding'
import type { Entry, Manifest, ReleasePin, ReleaseManifest, StoredModule } from '../lib/types'
interface Records {
  '@bundlebee/entry': Entry
  '@bundlebee/manifest': Manifest
  '@bundlebee/peer-deps': { readonly packages: ReadonlyArray<string> }
  '@bundlebee/release-pin': ReleasePin
  '@bundlebee/release-manifest': ReleaseManifest
  '@bundlebee/release-module': StoredModule
}
export function getEncoding<K extends keyof Records>(name: K): Encoder<Records[K]>
