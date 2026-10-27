import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

fs.rmSync('dist', { recursive: true, force: true })
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc'], { stdio: 'inherit' })
fs.cpSync('schema', 'dist/schema', { recursive: true })
fs.writeFileSync('index.cjs', "module.exports = require('./dist/index.js').default\n")

const names = [
  'HeadInfo',
  'BundlebeeOptions',
  'Entry',
  'ListedEntry',
  'Manifest',
  'ABIRecord',
  'AddOptions',
  'LoadOptions',
  'BundleInput',
  'ReleasePin',
  'Signal',
  'OperationOptions',
  'ReleaseQuery',
  'HostRequirement',
  'HostProvider',
  'ReleaseAsset',
  'PublishOptions',
  'Platform',
  'ReleaseLoadOptions',
  'LoadedRelease',
  'Store',
  'Core',
  'ReplicationStream'
]
const aliases = names
  .map((name) => `  type ${name} = import('./dist/lib/types').${name}`)
  .join('\n')
fs.writeFileSync(
  'index.d.cts',
  `import Base from './dist/index'
declare class Bundlebee extends Base {}
declare namespace Bundlebee {
${aliases}
}
export = Bundlebee
`
)
