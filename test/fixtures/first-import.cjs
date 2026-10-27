// Bundlebee must load before any test framework or traversal dependency.
const Bundlebee = require('../..')
const resolveBare = require('bare-module-traverse/resolve').bare
const Corestore = require('corestore')
const fs = require('bare-fs')
const os = require('bare-os')
const { pathToFileURL } = require('url-file-url')

async function main() {
  const directory = await fs.promises.mkdtemp(os.tmpdir() + '/bundlebee-first-')
  const bee = new Bundlebee(new Corestore(directory + '/store'))
  try {
    await fs.promises.writeFile(directory + '/index.js', "module.exports = require('./value.js')")
    await fs.promises.writeFile(directory + '/value.js', 'module.exports = 42')
    resolveBare({ specifier: './value.js', type: 1 }, pathToFileURL(directory + '/index.js')).next()
    const pin = await bee.publish(pathToFileURL(directory + '/'), 'index.js', {
      name: 'first-import',
      version: '1.0.0',
      abi: 1
    })
    const module = await bee.loadRelease(pin)
    if (module.exports !== 42) throw new Error('Unexpected module exports')
    console.log('published and loaded')
  } finally {
    await bee.close()
    await fs.promises.rm(directory, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error)
  Bare.exit(1)
})
