#!/usr/bin/env node
import * as fs from 'fs'
import * as path from 'path'
import { generate } from '.'
import { Logger } from './context'
import { runPrettier } from './prettify'
import * as yargs from 'yargs'
import { OpenAPIV3 } from 'openapi-types'

const log: Logger = (location, level, ...args) =>
  console.log(`${location}: ${level}:`, ...args)

type Format = 'ts' | 'json'

const parseArgs = () =>
  yargs
    .usage('Usage: $0 [options] FILE...')
    .option('format', {
      description: 'Output file format',
      choices: ['ts' as const, 'json' as const],
      default: 'ts' as Format,
    })
    .option('prettify', {
      alias: 'p',
      description: 'Apply prettier to output TypeScript files',
      type: 'boolean',
      default: false,
    }).argv

const outputFileName = (sourceFileName: string, ext: string): string =>
  sourceFileName.slice(0, -path.extname(sourceFileName).length) + ext

const main = async () => {
  const args = parseArgs()

  const sourceFiles = args._.map((x) => x.toString())
  const ext = args.format === 'ts' ? '.openapi.ts' : '.json'

  const results = generate(sourceFiles, { strict: true }, { log }).map(
    (result) => ({
      ...result,
      outputFileName: outputFileName(result.fileName, ext),
    })
  )

  for (const { outputFileName, paths } of results) {
    let content = args.format === 'ts' ? tsString(paths) : jsonString(paths)
    if (args.prettify) {
      content = await runPrettier(outputFileName, content)
    }
    console.log('Writing', outputFileName)
    fs.writeFileSync(outputFileName, content)
  }
}

const tsString = (paths: OpenAPIV3.PathsObject): string => `\
import { OpenAPIV3 } from 'openapi-types'

const spec: { paths: OpenAPIV3.PathsObject } = ${JSON.stringify({ paths })};

export default spec;
`

const jsonString = (paths: OpenAPIV3.PathsObject): string =>
  JSON.stringify({ paths })

main()
