import type { Core, ReadOptions } from './storage'
import type { OperationOptions } from './types'
import { ReleaseError, hasCode } from './errors'

export class Requests {
  readonly core: Core
  readonly options: OperationOptions
  readonly active: object[]
  readonly config: ReadOptions
  readonly abort: () => void
  private cancellation: Error | undefined

  constructor(core: Core, options: OperationOptions) {
    this.core = core
    this.options = options
    this.active = []
    this.cancellation = undefined
    this.config = { wait: !options.offline, activeRequests: this.active }
    this.abort = () => {
      const reason = options.signal?.reason
      this.cancellation =
        reason instanceof Error
          ? reason
          : new ReleaseError('ABORT_ERR', 'Release operation aborted', reason)
      core.constructor.destroyRequests(this.active, this.cancellation)
    }
    options.signal?.addEventListener('abort', this.abort, { once: true })
  }

  check(): void {
    if (this.options.signal?.aborted) {
      throw this.options.signal.reason ?? new ReleaseError('ABORT_ERR', 'Release operation aborted')
    }
  }

  fail(cause: unknown): never {
    if (cause === this.cancellation || hasCode(cause, 'REQUEST_CANCELLED')) this.check()
    if (
      this.options.offline &&
      hasCode(cause, 'BLOCK_NOT_AVAILABLE', 'ERR_BLOCK_NOT_AVAILABLE', 'SNAPSHOT_NOT_AVAILABLE')
    ) {
      throw new ReleaseError('ERR_RELEASE_NOT_CACHED', 'Pinned release is not fully cached', cause)
    }
    throw cause
  }

  close(): void {
    this.options.signal?.removeEventListener('abort', this.abort)
    this.core.constructor.destroyRequests(this.active)
  }
}
