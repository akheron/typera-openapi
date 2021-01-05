import * as ts from 'typescript'
import { OpenAPIV3 } from 'openapi-types'
import { Context, Logger, context, withLocation } from './context'
import {
  isDefined,
  isOptional,
  isObjectType,
  isUndefinedType,
  isPackageSymbol,
  getPropertyType,
} from './utils'

interface GenerateOptions {
  log: Logger
}

interface Result {
  fileName: string
  paths: OpenAPIV3.PathsObject
}

export const generate = (
  fileNames: string[],
  compilerOptions: ts.CompilerOptions,
  options?: GenerateOptions
): Result[] => {
  const log = options?.log || (() => undefined)
  const program = ts.createProgram(fileNames, compilerOptions)
  const checker = program.getTypeChecker()

  const result: Result[] = []

  for (const sourceFile of program.getSourceFiles()) {
    if (!fileNames.includes(sourceFile.fileName)) continue
    if (sourceFile.isDeclarationFile) continue

    ts.forEachChild(sourceFile, node => {
      const paths = visit(context(checker, sourceFile, log, node), node)
      if (paths) {
        result.push({ fileName: sourceFile.fileName, paths })
      }
    })
  }

  return result
}

const visit = (
  ctx: Context,
  node: ts.Node
): OpenAPIV3.PathsObject | undefined => {
  if (ts.isExportAssignment(node) && !node.isExportEquals) {
    // 'export default' statement
    const argSymbols = getRouterCallArgSymbols(ctx, node.expression)
    if (!argSymbols) return

    const paths: OpenAPIV3.PathsObject = {}

    argSymbols.forEach(symbol => {
      const location = symbol.valueDeclaration
      const routeDeclaration = getRouteDeclaration(
        withLocation(ctx, location),
        symbol
      )
      if (routeDeclaration) {
        const [path, pathItem] = routeDeclaration
        paths[path] = pathItem
      }
    })
    return paths
  }
}

const getRouterCallArgSymbols = (
  ctx: Context,
  expression: ts.Expression
): ts.Symbol[] | undefined => {
  if (!ts.isCallExpression(expression)) return

  const fn = expression.expression
  const args = expression.arguments

  // TODO: Check for router calls better than just checking the symbol name
  if (!ts.isIdentifier(fn) || fn.escapedText !== 'router') return

  const argSymbols = args
    .filter(ts.isIdentifier)
    .map(arg => ctx.checker.getSymbolAtLocation(arg))
    .filter(isDefined)

  if (argSymbols.length !== args.length) return
  return argSymbols
}

const getRouteDeclaration = (
  ctx: Context,
  symbol: ts.Symbol
): [string, OpenAPIV3.PathItemObject] | undefined => {
  const routeInput = getRouteInput(ctx, symbol)
  if (!routeInput) return
  const { method, path, requestNode, body, query, routeParams } = routeInput

  const responses = getResponseTypes(ctx, symbol)
  if (!responses) return

  const requestBody =
    requestNode && body
      ? typeToSchema(withLocation(ctx, requestNode), body)
      : undefined

  const parameters = [
    ...typeToParameters(ctx, 'path', routeParams),
    ...typeToParameters(ctx, 'query', query),
  ]

  const pathTemplate = path.replace(/:([^-.()/]+)\(.*?\)/g, '{$1}')

  return [
    pathTemplate,
    {
      [method]: {
        parameters: parameters.length > 0 ? parameters : undefined,
        ...operationRequestBody(requestBody),
        responses,
      },
    },
  ]
}

const operationRequestBody = (
  contentSchema: OpenAPIV3.SchemaObject | undefined
): { requestBody: OpenAPIV3.RequestBodyObject } | undefined => {
  if (!contentSchema) return
  return {
    requestBody: { content: { 'application/json': { schema: contentSchema } } },
  }
}

const methodNames = [
  'get',
  'post',
  'put',
  'delete',
  'head',
  'options',
  'patch',
  'all',
]

interface RouteInput {
  method: string
  path: string
  requestNode: ts.Node | undefined
  body: ts.Type | undefined
  query: ts.Type | undefined
  routeParams: ts.Type | undefined
}

const getRouteInput = (
  ctx: Context,
  symbol: ts.Symbol
): RouteInput | undefined => {
  const declaration = symbol.valueDeclaration
  if (!ts.isVariableDeclaration(declaration)) return

  let expr = declaration.initializer
  if (!expr) return

  let method: string | undefined,
    path: string | undefined,
    requestNode: ts.Node | undefined,
    body: ts.Type | undefined,
    query: ts.Type | undefined,
    routeParams: ts.Type | undefined

  while (ts.isCallExpression(expr)) {
    const lhs: ts.LeftHandSideExpression = expr.expression
    if (ts.isIdentifier(lhs)) {
      // Direct route() call
      if (expr.arguments.length != 2) {
        ctx.log('warn', 'Expected 2 arguments for route()')
        return
      }
      const methodArg = expr.arguments[0]
      const pathArg = expr.arguments[1]
      if (!ts.isStringLiteral(methodArg) || !ts.isStringLiteral(pathArg)) {
        ctx.log('warn', 'method and path must be string literals')
        return
      }
      method = methodArg.text
      path = pathArg.text

      // Property access chain ends
      break
    } else if (ts.isPropertyAccessExpression(lhs)) {
      if (!ts.isIdentifier(lhs.name)) return
      const fnName = lhs.name.escapedText.toString()
      if (methodNames.includes(fnName)) {
        method = fnName
        const pathArg = expr.arguments[0]
        if (!pathArg) {
          ctx.log('warn', `No argument for method ${fnName}`)
          return
        }
        if (!ts.isStringLiteral(pathArg)) {
          ctx.log('warn', `Method ${fnName} argument is not a string literal`)
          return
        }
        path = pathArg.text
      } else if (fnName === 'handler') {
        const handlerFn = expr.arguments[0]
        if (
          !handlerFn ||
          (!ts.isArrowFunction(handlerFn) &&
            !ts.isFunctionExpression(handlerFn))
        ) {
          ctx.log('warn', 'Handler is not a function')
          return
        }
        const req = handlerFn.parameters[0]
        if (req) {
          const type = ctx.checker.getTypeAtLocation(req)
          body = getPropertyType(ctx.checker, req, type, 'body')
          query = getPropertyType(ctx.checker, req, type, 'query')
          routeParams = getPropertyType(ctx.checker, req, type, 'routeParams')
          requestNode = req
        }
      }
      expr = lhs.expression
    } else {
      // Do nothing, I guess
    }
  }
  if (!method) {
    ctx.log('warn', 'Could not determine route method')
    return
  }
  if (!path) {
    ctx.log('warn', 'Could not determine route path')
    return
  }
  if (method === 'all') {
    ctx.log('warn', "The 'all' method is not supported, skipping route")
    return
  }
  return { method, path, requestNode, body, query, routeParams }
}

const getResponseTypes = (
  ctx: Context,
  symbol: ts.Symbol
): OpenAPIV3.ResponsesObject | undefined => {
  const routeType = ctx.checker.getTypeOfSymbolAtLocation(
    symbol,
    symbol.valueDeclaration
  )

  if (
    !routeType.aliasSymbol ||
    !isPackageSymbol(routeType.aliasSymbol, 'typera-common', 'Route')
  ) {
    return
  }

  const args = routeType.aliasTypeArguments
  if (!args || args.length !== 1) {
    throw new Error('expected 1 type argument for Route')
  }
  const responseType = args[0]

  const result: OpenAPIV3.ResponsesObject = {}
  if (isObjectType(responseType)) {
    const responseDef = getResponseDefinition(ctx, responseType)
    if (responseDef) result[responseDef.status] = responseDef.response
  } else if (responseType.isUnion()) {
    responseType.types.forEach(type => {
      const responseDef = getResponseDefinition(ctx, type)
      if (responseDef) result[responseDef.status] = responseDef.response
    })
  }

  if (Object.keys(result).length === 0) {
    // Any response types could not be determined so this is not a valid route after all
    return
  }

  return result
}

const getResponseDefinition = (
  ctx: Context,
  responseType: ts.Type
): { status: string; response: OpenAPIV3.ResponseObject } | undefined => {
  const statusSymbol = responseType.getProperty('status')
  const bodySymbol = responseType.getProperty('body')
  const headersSymbol = responseType.getProperty('headers')
  if (!statusSymbol || !bodySymbol || !headersSymbol) return

  const statusType = ctx.checker.getTypeOfSymbolAtLocation(
    statusSymbol,
    statusSymbol.valueDeclaration
  )
  const bodyType = ctx.checker.getTypeOfSymbolAtLocation(
    bodySymbol,
    bodySymbol.valueDeclaration
  )
  const headersType = ctx.checker.getTypeOfSymbolAtLocation(
    headersSymbol,
    headersSymbol.valueDeclaration
  )
  if (!statusType || !bodyType || !headersType) return

  if (!(statusType.flags & ts.TypeFlags.NumberLiteral)) {
    return
  }

  const status = ctx.checker.typeToString(statusType)

  // TODO: If bodyType is an interface (or type alias?), generate a schema
  // component object and a reference to it?
  let bodySchema: OpenAPIV3.SchemaObject | undefined
  if (!isUndefinedType(bodyType)) {
    bodySchema = typeToSchema(ctx, bodyType)
    if (!bodySchema) return
  }

  const headers = !isUndefinedType(headersType)
    ? typeToHeaders(ctx, headersType)
    : undefined

  return {
    status,
    response: {
      description: status, // TODO: What should the response description be?
      ...(bodySchema
        ? {
            content: {
              // TODO: application/json should probably not be hard-coded
              'application/json': {
                schema: bodySchema,
              },
            },
          }
        : undefined),
      ...(headers
        ? {
            headers,
          }
        : undefined),
    },
  }
}

const typeToParameters = (
  ctx: Context,
  in_: 'path' | 'query' | 'header' | 'cookie',
  type: ts.Type | undefined
): OpenAPIV3.ParameterObject[] => {
  if (!type) return []

  const props = ctx.checker.getPropertiesOfType(type)
  return props.map(prop => ({
    name: prop.name,
    in: in_,
    required: in_ === 'path' ? true : !isOptional(prop),
  }))
}

interface Headers {
  [header: string]: OpenAPIV3.HeaderObject
}

const typeToHeaders = (ctx: Context, type: ts.Type): Headers => {
  const result: Headers = {}
  const props = ctx.checker.getPropertiesOfType(type)
  props.forEach(prop => {
    result[prop.name] = {
      required: !isOptional(prop),
    }
  })
  return result
}

const typeToSchema = (
  ctx: Context,
  type: ts.Type,
  optional = false
): OpenAPIV3.SchemaObject | undefined => {
  if (type.isUnion()) {
    const elems = optional
      ? type.types.filter(elem => !isUndefinedType(elem))
      : type.types

    if (elems.every(elem => elem.flags & ts.TypeFlags.BooleanLiteral)) {
      // All elements are boolean literals => boolean
      return { type: 'boolean' }
    } else if (elems.length >= 2) {
      // 2 or more types remain => anyOf
      return {
        anyOf: elems.map(elem => typeToSchema(ctx, elem)).filter(isDefined),
      }
    } else {
      // Only one element left in the union. Fall through and consider it as the
      // sole type.
      type = elems[0]
    }
  }

  if (
    isObjectType(type) ||
    (type.isIntersection() && type.types.every(part => isObjectType(part)))
  ) {
    const props = ctx.checker.getPropertiesOfType(type)
    return {
      type: 'object',
      required: props.filter(prop => !isOptional(prop)).map(prop => prop.name),
      properties: Object.fromEntries(
        props
          .map(prop => {
            const propType = ctx.checker.getTypeOfSymbolAtLocation(
              prop,
              ctx.location
            )
            if (!propType) {
              ctx.log('warn', 'Could not get type for property', prop.name)
              return
            }
            const propSchema = typeToSchema(ctx, propType, isOptional(prop))
            if (!propSchema) {
              ctx.log('warn', 'Could not get schema for property', prop.name)
              return
            }
            return [prop.name, propSchema]
          })
          .filter(isDefined)
      ),
    }
  }

  if (type.flags & ts.TypeFlags.String) {
    return { type: 'string' }
  }
  if (type.flags & ts.TypeFlags.Number) {
    return { type: 'number' }
  }
  if (type.flags & ts.TypeFlags.Boolean) {
    return { type: 'boolean' }
  }

  ctx.log('warn', `Ignoring an unknown type: ${ctx.checker.typeToString(type)}`)
  return
}
