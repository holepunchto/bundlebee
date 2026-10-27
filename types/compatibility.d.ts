import type URL from 'bare-url'
import type Module from 'bare-module'

// bare-module 7.1 accepts an object of host exports; its declaration says string[].
declare module 'bare-module' {
  function load(
    url: URL,
    options: Omit<LoadOptions, 'builtins'> & { builtins: Record<string, unknown> }
  ): Promise<Module>
}
