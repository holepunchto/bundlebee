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
      },
      {
        name: 'trace',
        type: '@bundlebee/checkout'
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

  ns.register({
    name: 'checkout',
    fields: [
      {
        name: 'key',
        type: 'fixed32',
        required: true
      },
      {
        name: 'length',
        type: 'uint',
        required: true
      }
    ]
  })
}

Hyperschema.toDisk(schema, { esm: false })
