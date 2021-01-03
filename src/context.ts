import * as ts from 'typescript'

export interface Context {
  checker: ts.TypeChecker
  location: ts.Node
}

export const context = (
  checker: ts.TypeChecker,
  location: ts.Node
): Context => ({ checker, location })

export const withLocation = (ctx: Context, location: ts.Node): Context => ({
  ...ctx,
  location,
})
