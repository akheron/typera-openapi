export { GenerateResult, generate } from './generate'
export { LogLevel } from './context'
import { OpenAPIV3 } from 'openapi-types'

export const prefix = (
  prefix: string,
  paths: OpenAPIV3.PathsObject
): OpenAPIV3.PathsObject =>
  Object.fromEntries(
    Object.entries(paths).map(([path, value]) => [prefix + path, value])
  )
