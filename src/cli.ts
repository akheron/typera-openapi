#!/usr/bin/env node
import * as fs from 'fs'
import * as path from 'path'
import * as ts from 'typescript'
import * as yargs from 'yargs'

import { GenerateOutput, generate } from '.'
import { Logger } from './context'
import { runPrettier } from './prettify'

const log: Logger = (location, level, ...args) =>
  console.log(`${location}: ${level}:`, ...args)

type Format = 'ts' | 'json'

const parseArgs = () =>
  yargs
    .usage('Usage: $0 [options] FILE...')
    .option('verbose', {
      description: 'Verbose output',
      type: 'boolean',
      default: false,
    })
    .option('outfile', {
      alias: 'o',
      description: 'Output file. Must end in `.ts` or `.json`.',
      default: 'openapi.ts',
      coerce: (arg: string): [string, Format] => {
        if (arg.endsWith('.ts')) return [arg, 'ts']
        if (arg.endsWith('.json')) return [arg, 'json']
        throw new Error('outfile must end in `.ts` or `.json`')
      },
    })
    .option('tsconfig', {
      description: 'Which tsconfig.json to use',
      default: 'tsconfig.json',
    })
    .option('prettify', {
      alias: 'p',
      description: 'Apply prettier to the output file',
      type: 'boolean',
      default: false,
    })
    .option('check', {
      alias: 'c',
      description:
        'Exit with an error if the output file is not up-to-date (useful for CI)',
      type: 'boolean',
      default: false,
    }).argv

const main = async (): Promise<number> => {
  const args = parseArgs()

  const sourceFiles = args._.map((x) => x.toString())
  if (sourceFiles.length === 0) {
    console.error('error: No source files given')
    return 1
  }
  const [outfile, format] = args.outfile

  const compilerOptions = readCompilerOptions(args.tsconfig)
  if (!compilerOptions) process.exit(1)

  if (args.verbose) {
    console.log(`Compiler options: ${JSON.stringify(compilerOptions, null, 2)}`)
  }

  const { output, unseenFileNames } = generate(sourceFiles, compilerOptions, {
    log,
  })
  if (unseenFileNames.length > 0) {
    console.error(
      `error: The following files don't exist or didn't contain any routes: ${unseenFileNames.join(
        ', '
      )}`
    )
    return 1
  }

  let content = format === 'ts' ? tsString(output) : jsonString(output)
  if (args.prettify) {
    content = await runPrettier(outfile, content)
  }
  if (args.check) {
    if (!checkOutput(outfile, content)) return 1
  } else {
    writeOutput(outfile, content)
  }

  return 0
}

const readCompilerOptions = (
  tsconfigPath: string
): ts.CompilerOptions | undefined => {
  const dirPath = path.dirname(tsconfigPath)
  const fileName = path.basename(tsconfigPath)

  const tsconfig = ts.readConfigFile(tsconfigPath, (path) =>
    fs.readFileSync(path, 'utf-8')
  )
  if (tsconfig.error) {
    console.error(
      `Unable to read ${tsconfigPath}: ${tsconfig.error.messageText}`
    )
    console.error(`(Tip: Use --tsconfig to specify configuration file path)`)
    return
  }

  const result = ts.convertCompilerOptionsFromJson(
    tsconfig.config.compilerOptions,
    dirPath,
    fileName
  )
  if (result.errors.length) {
    console.error(
      `Invalid tsconfig ${tsconfigPath}:\n${result.errors
        .map((err) => err.messageText)
        .join('\n')}`
    )
    return
  }
  return result.options
}

const checkOutput = (fileName: string, content: string): boolean => {
  const current = fs.readFileSync(fileName, 'utf-8')
  if (current !== content) {
    console.log(`${fileName} is out of date`)
    return false
  }
  return true
}

const writeOutput = (fileName: string, content: string): void => {
  console.log('Writing', fileName)
  fs.writeFileSync(fileName, content)
}

const tsString = (result: GenerateOutput): string => `\
import { OpenAPIV3 } from 'openapi-types'

const spec: { paths: OpenAPIV3.PathsObject, components: OpenAPIV3.ComponentsObject } = ${JSON.stringify(
  result
)};

export default spec;
`

const jsonString = (result: GenerateOutput): string => JSON.stringify(result)

main().then((status) => {
  if (status !== 0) process.exit(status)
})
