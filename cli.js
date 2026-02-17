#!/usr/bin/env bare

const { command, flag, arg, summary, description, header, validate } = require('paparam')
const Hyperbundle = require('./')
const Corestore = require('corestore')
const path = require('path')
const fs = require('fs')
const z32 = require('z32')
const os = require('os')
const c = require('compact-encoding')
const { getEncoding } = require('./schema')

const defaultStorage = path.join(os.homedir(), '.hyperbundle')
const Entry = getEncoding('@hyperbundle/entry')

const storeCmd = command(
  'store',
  summary('Store a folder into a bundlebee'),
  description('Traverse and bundle a folder entry point into a hyperbee store.'),
  flag('--storage|-s <path>', 'corestore storage path (default: ~/.bundlebee)'),
  flag('--name|-n [name]', 'name of the hyperbee (default: folder basename)'),
  flag('--skip-modules', 'skip node_modules (default: true)'),
  arg('<folder>', 'project folder to bundle'),
  arg('[entrypoint]', 'entry point relative to folder (default: index.js)'),
  validate(({ args }) => {
    const folder = path.resolve(args.folder)

    if (!fs.existsSync(folder)) return 'folder does not exist: ' + folder
    if (!fs.statSync(folder).isDirectory()) return 'path is not a directory: ' + folder

    const entrypoint = args.entrypoint || 'index.js'
    const entryPath = path.join(folder, entrypoint)

    if (!fs.existsSync(entryPath)) return 'entrypoint does not exist: ' + entryPath

    return true
  }),
  async () => {
    const folder = path.resolve(storeCmd.args.folder)
    const entrypoint = storeCmd.args.entrypoint || 'index.js'
    const storagePath = storeCmd.flags.storage || defaultStorage
    const name = storeCmd.flags.name || path.basename(folder)
    const skipModules = storeCmd.flags.skipModules !== false

    const store = new Corestore(storagePath)
    const b = new Hyperbundle(store, { core: store.get({ name }) })

    const root = new URL('file://' + folder + '/')

    console.log('Storing', folder, 'with entry', entrypoint)
    console.log('Storage:', path.resolve(storagePath))
    console.log('Name:', name)

    const bundle = await b.add(root, entrypoint, { skipModules })

    const files = Object.keys(bundle.files)
    if (files.length === 0) {
      console.log('No changes detected.')
    } else {
      console.log('Added', files.length, 'file(s):')
      for (const f of files) console.log(' ', f)
    }

    console.log('\nKey:', z32.encode(b.key))

    await b.close()
  }
)

const checkoutCmd = command(
  'checkout',
  summary('Checkout files from a Hyperbundle to a folder'),
  description('Read all entries from the hyperbee and write them to disk.'),
  flag('--storage|-s <path>', 'corestore storage path (default: ~/.hyperbundle)'),
  flag('--name|-n [name]', 'name of the hyperbee'),
  flag('--key|-k [key]', 'source Hyperbundle key to checkout from'),
  flag('--version|-v [length]', 'checkout at a specific hyperbee length'),
  arg('<folder>', 'output folder to write files into'),
  validate(({ flags }) => {
    if (!flags.name && !flags.key) return 'either --name or --key is required'
    if (flags.version && (isNaN(Number(flags.version)) || Number(flags.version) <= 0)) {
      return '--version must be a positive number'
    }
    return true
  }),
  async () => {
    const folder = path.resolve(checkoutCmd.args.folder)
    const storagePath = checkoutCmd.flags.storage || defaultStorage
    const version = checkoutCmd.flags.version ? Number(checkoutCmd.flags.version) : undefined
    const key = checkoutCmd.flags.key ? z32.decode(checkoutCmd.flags.key) : null
    const name = checkoutCmd.flags.name || null

    const store = new Corestore(storagePath)
    const b = new Hyperbundle(store, { core: store.get({ key, name }) })

    const bee = await b.checkout(version)

    console.log('Checking out to', folder)
    if (version) console.log('At version:', version)

    let count = 0
    for await (const data of bee.createReadStream()) {
      const id = data.key.toString()
      const entry = c.decode(Entry, data.value)

      const filePath = path.join(folder, id)
      const dir = path.dirname(filePath)

      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(filePath, entry.source)

      console.log(' ', id)
      count++
    }

    console.log('Wrote', count, 'file(s)')

    await b.close()
  }
)

const listCmd = command(
  'list',
  summary('List files in a Hyperbundle'),
  description('List all file entries stored in the hyperbee.'),
  flag('--storage|-s <path>', 'corestore storage path (default: ~/.hyperbundle)'),
  flag('--name|-n [name]', 'name of the hyperbee'),
  flag('--key|-k [key]', 'source Hyperbundle key to list from'),
  flag('--version|-v [length]', 'list at a specific hyperbee length'),
  validate(({ flags }) => {
    if (!flags.name && !flags.key) return 'either --name or --key is required'
    if (flags.version && (isNaN(Number(flags.version)) || Number(flags.version) <= 0)) {
      return '--version must be a positive number'
    }
    return true
  }),
  async () => {
    const storagePath = listCmd.flags.storage || defaultStorage
    const version = listCmd.flags.version ? Number(listCmd.flags.version) : undefined
    const key = listCmd.flags.key ? z32.decode(listCmd.flags.key) : null
    const name = listCmd.flags.name || null

    const store = new Corestore(storagePath)
    const b = new Hyperbundle(store, { core: store.get({ key, name }) })

    const bee = await b.checkout(version)

    let count = 0
    for await (const data of bee.createReadStream()) {
      const id = data.key.toString()
      const entry = c.decode(Entry, data.value)
      console.log(id, `(${entry.source.length} bytes)`)
      count++
    }

    console.log('\n' + count, 'file(s)')

    await b.close()
  }
)

const cmd = command(
  'hyperbundle',
  summary('Bundle modules into a hyperbee'),
  header('Hyperbundle - hyperbee module bundler'),
  storeCmd,
  checkoutCmd,
  listCmd,
  () => console.log(cmd.help())
)

cmd.parse()
