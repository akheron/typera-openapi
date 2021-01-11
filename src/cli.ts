#!/usr/bin/env node
import * as fs from 'fs'
import * as path from 'path'
import { generate } from '.'
import { Logger } from './context'
import * as yargs from 'yargs'

const log: Logger = (location, level, ...args) =>
  console.log(`${location}: ${level}:`, ...args)

type Format = 'ts' | 'json'

const parseArgs = () =>
  yargs.usage('Usage: $0 [options] FILE...').option('format', {
    description: 'Output file format',
    choices: ['ts' as const, 'json' as const],
    default: 'ts' as Format,
  }).argv

const outputFileName = (sourceFileName: string, ext: string): string =>
  sourceFileName.slice(0, -path.extname(sourceFileName).length) + ext

const main = () => {
  const args = parseArgs()

  const sourceFiles = args._.map((x) => x.toString())
  const ext = args.format === 'ts' ? '.openapi.ts' : '.json'

  const results = generate(sourceFiles, { strict: true }, { log }).map(
    (result) => ({
      ...result,
      outputFileName: outputFileName(result.fileName, ext),
    })
  )

  results.forEach(({ outputFileName, paths }) => {
    const resultObject = JSON.stringify({ paths })
    const content =
      args.format === 'ts'
        ? `\
import { OpenAPIV3 } from 'openapi-types'

const spec: { paths: OpenAPIV3.PathsObject } = ${resultObject};

export default spec;
`
        : resultObject
    console.log('Writing', outputFileName)
    fs.writeFileSync(outputFileName, content)
  })
}

main()
