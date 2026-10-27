import Hyperschema from 'hyperschema'

export const schema = Hyperschema.from('./schema', { import: false })

{
  const ns = schema.namespace('bundlebee')

  ns.register({
    name: 'resolutions',
    record: true,
    key: 'string',
    value: 'string'
  })

  ns.register({
    name: 'entry',
    fields: [
      {
        name: 'source',
        type: 'buffer',
        required: true
      },
      {
        name: 'resolutions',
        required: true,
        type: '@bundlebee/resolutions'
      }
    ]
  })

  ns.register({
    name: 'manifest',
    fields: [
      {
        name: 'abi',
        type: 'uint',
        required: true
      }
    ]
  })

  ns.register({
    name: 'peer-deps',
    fields: [
      {
        name: 'packages',
        type: 'string',
        array: true,
        required: true
      }
    ]
  })

  const releases = ns
  for (const [name, fields] of Object.entries({
    'release-pin': [
      ['format', 'uint'],
      ['key', 'string'],
      ['length', 'uint'],
      ['name', 'string'],
      ['version', 'string'],
      ['entry', 'string'],
      ['abi', 'uint']
    ],
    'release-asset': [
      ['path', 'string'],
      ['platform', 'string'],
      ['arch', 'string']
    ],
    'host-requirement': [
      ['specifier', 'string'],
      ['version', 'string'],
      ['abi', 'string'],
      ['platform', 'string'],
      ['arch', 'string']
    ],
    'release-module': [
      ['source', 'buffer'],
      ['resolutions', 'string']
    ]
  })) {
    releases.register({
      name,
      fields: fields.map(([name, type]) => ({ name, type, required: true }))
    })
  }
  releases.register({
    name: 'release-manifest',
    fields: [
      { name: 'format', type: 'uint', required: true },
      { name: 'name', type: 'string', required: true },
      { name: 'version', type: 'string', required: true },
      { name: 'entry', type: 'string', required: true },
      { name: 'abi', type: 'uint', required: true },
      { name: 'files', type: 'string', array: true, required: true },
      { name: 'assets', type: '@bundlebee/release-asset', array: true, required: true },
      { name: 'hosts', type: '@bundlebee/host-requirement', array: true, required: true }
    ]
  })
}

Hyperschema.toDisk(schema, { esm: false })
