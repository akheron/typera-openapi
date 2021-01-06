import * as path from 'path'
import { generate } from '../src/index'

describe('generate', () => {
  it('works', () => {
    const testRoutes = path.relative(
      process.cwd(),
      __dirname + '/test-routes.ts'
    )
    const result = generate([testRoutes], { strict: true })
    expect(result).toMatchSnapshot()
  })
})
