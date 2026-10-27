export class ReleaseError extends Error {
  readonly code: string

  constructor(code: string, message: string, cause?: unknown) {
    super(message, { cause })
    this.code = code
  }
}

export function hasCode(error: unknown, ...codes: ReadonlyArray<string>): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    codes.includes(error.code)
  )
}
