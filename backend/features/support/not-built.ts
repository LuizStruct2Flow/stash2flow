/** The one message every skeleton step fails with. The pending check recognises it. */
export const NOT_BUILT_MESSAGE = 'This step is not built yet.'

export class NotBuilt extends Error {
  override name = 'NotBuilt'
  constructor() {
    super(NOT_BUILT_MESSAGE)
  }
}

export function notBuilt(): never {
  throw new NotBuilt()
}
