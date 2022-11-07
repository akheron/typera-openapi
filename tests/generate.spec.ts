import * as path from 'path'
import * as SwaggerParser from '@apidevtools/swagger-parser'
import { LogLevel, generate } from '../src/index'

const relativePath = (fileName: string): string =>
  path.relative(process.cwd(), __dirname + '/' + fileName)

const testRoutes = relativePath('test-routes.ts')
const otherRoutes = relativePath('other-routes.ts')
const warningRoutes = relativePath('warning-routes.ts')
const duplicatedOperationIdsRoutes = relativePath(
  'duplicated-operation-ids-routes.ts'
)

interface LogMessage {
  location: string
  level: LogLevel
  message: string
}

describe('generate', () => {
  it('works', async () => {
    const { output, unseenFileNames } = generate([testRoutes, otherRoutes], {
      strict: true,
    })

    // - Throws if output is invalid
    // - Mutates the input if passed as an object (!), so round-trip through JSON first
    await SwaggerParser.validate(
      JSON.parse(
        JSON.stringify({
          openapi: '3.0.0',
          info: { title: 'test', version: '1' },
          ...output,
        })
      ),
      { resolve: { external: false } }
    )

    expect(output).toMatchSnapshot()
    expect(unseenFileNames).toEqual([])
  })

  it('warnings', () => {
    const warnings: LogMessage[] = []
    generate(
      [warningRoutes],
      { strict: true },
      {
        log: (location, level, ...messages) =>
          warnings.push({ location, level, message: messages.join(' ') }),
      }
    )
    expect(warnings).toMatchSnapshot()
  })

  it('duplicated operationId warnings', () => {
    const warnings: LogMessage[] = []
    generate(
      [duplicatedOperationIdsRoutes],
      { strict: true },
      {
        log: (location, level, ...messages) =>
          warnings.push({ location, level, message: messages.join(' ') }),
      }
    )
    expect(warnings).toMatchSnapshot()
  })
})
