import * as ts from 'typescript'

export type LogLevel = 'verbose' | 'info' | 'warn' | 'error'

export type Logger = (
  location: string,
  level: LogLevel,
  ...messages: any[]
) => void

export interface Context {
  checker: ts.TypeChecker
  source: ts.SourceFile
  log(level: LogLevel, ...messages: any[]): void
  location: ts.Node
}

export const context = (
  checker: ts.TypeChecker,
  source: ts.SourceFile,
  log: Logger,
  location: ts.Node
): Context => ({
  checker,
  source,
  log(level, ...messages) {
    const { line, character } = source.getLineAndCharacterOfPosition(
      // location is updated, get it from this
      this.location.getStart()
    )
    log(`${source.fileName}:${line + 1}:${character}`, level, ...messages)
  },
  location,
})

export const withLocation = (ctx: Context, location: ts.Node): Context => ({
  ...ctx,
  location,
})
