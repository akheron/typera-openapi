import { Middleware } from 'typera-express'
import { urlencoded } from 'body-parser'

export const formUrlEncodedMiddleware = Middleware.wrapNative<
  Record<'contentType', 'application/x-www-form-urlencoded'>
>(
  // TODO: typera's typings don't like connect middleware
  urlencoded() as any
)
