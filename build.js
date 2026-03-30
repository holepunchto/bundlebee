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
    name: 'trace',
    fields: [
      {
        name: 'core',
        type: 'uint',
        required: true
      },
      {
        name: 'seq',
        type: 'uint',
        required: true
      }
    ]
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
      },
      {
        name: 'trace',
        type: '@bundlebee/trace',
        array: true
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
}

Hyperschema.toDisk(schema, { esm: false })
