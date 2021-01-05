import * as ts from 'typescript'

export type Logger = (
  level: 'verbose' | 'info' | 'warn' | 'error',
  ...messages: any[]
) => void

export interface Context {
  checker: ts.TypeChecker
  log: Logger
  location: ts.Node
}

export const context = (
  checker: ts.TypeChecker,
  log: Logger,
  location: ts.Node
): Context => ({ checker, log, location })

export const withLocation = (ctx: Context, location: ts.Node): Context => ({
  ...ctx,
  location,
})
