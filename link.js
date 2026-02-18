const { constructor: PearLink } = require('pear-link')

class ModuleLink extends PearLink {
  serialize(o) {
    console.log(o)
    if (o.protocol?.startsWith('module:') === false) return super.serialize(o)
    o.protocol = o.protocol
    o.origin = o.origin
    return super.serialize(o)
  }
  parse(link) {
    if (link.startsWith('module+pear:') === false) return super.parse(link)
    const parsed = super.parse(link.slice(7))
    parsed.protocol = 'module+' + parsed.protocol
    parsed.origin = 'module+' + parsed.origin
    return parsed
  }
}

module.exports = new ModuleLink()
