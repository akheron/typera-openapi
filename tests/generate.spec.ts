import * as path from 'path'
import { LogLevel, generate } from '../src/index'

const relativePath = (fileName: string): string =>
  path.relative(process.cwd(), __dirname + '/' + fileName)

const testRoutes = relativePath('test-routes.ts')
const warningRoutes = relativePath('warning-routes.ts')

describe('generate', () => {
  it('works', () => {
    const result = generate([testRoutes], { strict: true })
    expect(result).toMatchSnapshot()
  })

  it('warnings', () => {
    interface LogMessage {
      location: string
      level: LogLevel
      message: string
    }
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
})
