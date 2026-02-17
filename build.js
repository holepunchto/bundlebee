import Hyperschema from 'hyperschema'

export const schema = Hyperschema.from('./schema', { import: false })

{
  const ns = schema.namespace('bundlebee')

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
        type: 'stringRecord',
        required: true
      }
    ]
  })
}

Hyperschema.toDisk(schema, { esm: false })
