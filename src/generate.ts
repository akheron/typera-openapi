import * as ts from 'typescript'
import { OpenAPIV3 } from 'openapi-types'
import * as statuses from 'statuses'
import { Context, Logger, context, withLocation } from './context'
import {
  isDefined,
  isOptional,
  isObjectType,
  isUndefinedType,
  getPropertyType,
  isNullType,
  isStringType,
  isNumberType,
  isBooleanType,
  isBooleanLiteralType,
  isNumberLiteralType,
  isStringLiteralType,
  isArrayType,
  isDateType,
  isBufferType,
  getBrandedType,
  getPromisePayloadType,
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

    ts.forEachChild(sourceFile, (node) => {
      const paths = visitTopLevelNode(
        context(checker, sourceFile, log, node),
        node
      )
      if (paths) {
        result.push({ fileName: sourceFile.fileName, paths })
      }
    })
  }

  return result
}

const visitTopLevelNode = (
  ctx: Context,
  node: ts.Node
): OpenAPIV3.PathsObject | undefined => {
  if (ts.isExportAssignment(node) && !node.isExportEquals) {
    // 'export default' statement
    const argSymbols = getRouterCallArgSymbols(ctx, node.expression)
    if (!argSymbols) return

    const paths: OpenAPIV3.PathsObject = {}

    argSymbols.forEach((symbol) => {
      let location = symbol.valueDeclaration
      if (!location && symbol.flags & ts.SymbolFlags.Alias) {
        symbol = ctx.checker.getAliasedSymbol(symbol)
        location = symbol.valueDeclaration
      }
      if (!location) {
        ctx.log(
          'warn',
          `Could not find the definition of router arg ${symbol.name}`
        )
        return
      }
      const routeDeclaration = getRouteDeclaration(
        withLocation(ctx, location),
        symbol
      )
      if (routeDeclaration) {
        const [path, method, operation] = routeDeclaration
        const pathsItemObject = paths[path]
        if (!pathsItemObject) {
          paths[path] = { [method]: operation }
        } else {
          pathsItemObject[method] = operation
        }
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
    .map((arg) => ctx.checker.getSymbolAtLocation(arg))
    .filter(isDefined)

  if (argSymbols.length !== args.length) return
  return argSymbols
}

const getRouteDeclaration = (
  ctx: Context,
  symbol: ts.Symbol
): [string, Method, OpenAPIV3.OperationObject] | undefined => {
  const description = getDescriptionFromComment(ctx, symbol)
  const summary = getRouteSummary(symbol)
  const tags = getRouteTags(symbol)
  const routeInput = getRouteInput(ctx, symbol)
  if (!routeInput) {
    ctx.log('warn', `Could not determine route input for symbol ${symbol.name}`)
    return
  }
  const {
    method,
    path,
    requestNode,
    body,
    query,
    headers,
    routeParams,
    cookies,
  } = routeInput

  const responses = getResponseTypes(ctx, symbol)
  if (!responses) return

  const requestBody =
    requestNode && body
      ? typeToSchema(withLocation(ctx, requestNode), body)
      : undefined

  const parameters = [
    ...typeToParameters(ctx, 'path', routeParams),
    ...typeToParameters(ctx, 'query', query),
    ...typeToParameters(ctx, 'header', headers),
    ...typeToParameters(ctx, 'cookie', cookies),
  ]

  const pathTemplate = path.replace(/:([^-.()/]+)(\(.*?\))?/g, '{$1}')

  return [
    pathTemplate,
    method,
    {
      ...(summary ? { summary } : undefined),
      ...(description ? { description } : undefined),
      ...(tags && tags.length > 0 ? { tags } : undefined),
      ...(parameters.length > 0 ? { parameters } : undefined),
      ...operationRequestBody(requestBody),
      responses,
    },
  ]
}

const getDescriptionFromComment = (ctx: Context, symbol: ts.Symbol) =>
  symbol
    .getDocumentationComment(ctx.checker)
    .map((part) => part.text)
    .join('')

const getRouteSummary = (symbol: ts.Symbol): string | undefined =>
  symbol
    .getJsDocTags()
    .filter((tag) => tag.name === 'summary')
    .flatMap((tag) => tag.text)
    .filter(isDefined)
    .map((symbolDisplayPart) => symbolDisplayPart.text)[0]

const getRouteTags = (symbol: ts.Symbol): string[] | undefined =>
  symbol
    .getJsDocTags()
    .filter((tag) => tag.name === 'tags')
    .flatMap((tag) => tag.text)
    .filter(isDefined)
    .flatMap((symbolDisplayPart) => symbolDisplayPart.text.split(','))
    .map((tag) => tag.trim())

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
] as const

type Method = Exclude<typeof methodNames[number], 'all'>

const isMethod = (value: string): value is Method =>
  methodNames.some((method) => value === method)

interface RouteInput {
  method: Method
  path: string
  requestNode: ts.Node | undefined
  body: ts.Type | undefined
  query: ts.Type | undefined
  headers: ts.Type | undefined
  routeParams: ts.Type | undefined
  cookies: ts.Type | undefined
}

const getRouteInput = (
  ctx: Context,
  symbol: ts.Symbol
): RouteInput | undefined => {
  const declaration = symbol.valueDeclaration
  if (!declaration) return

  let expr = ts.isVariableDeclaration(declaration)
    ? declaration.initializer
    : ts.isExportAssignment(declaration)
    ? declaration.expression
    : undefined
  if (!expr) return

  let method: Method | undefined,
    path: string | undefined,
    requestNode: ts.Node | undefined,
    body: ts.Type | undefined,
    query: ts.Type | undefined,
    routeParams: ts.Type | undefined,
    headers: ts.Type | undefined,
    cookies: ts.Type | undefined

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
      if (!isMethod(methodArg.text)) {
        ctx.log('warn', 'Unsupported method ${methodArg.text}')
        return
      }
      method = methodArg.text
      path = pathArg.text

      // Done
      break
    } else if (ts.isPropertyAccessExpression(lhs)) {
      if (!ts.isIdentifier(lhs.name)) return
      const fnName = lhs.name.escapedText.toString()
      if (isMethod(fnName)) {
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

        // Done
        break
      } else if (fnName === 'handler') {
        // routeConstructor: {
        //   handler: (routeHandler: (req) => ...)
        // }
        //
        // We want to dig out the type of `req`.
        //
        const routeConstructor = lhs.expression
        const routeConstructorType =
          ctx.checker.getTypeAtLocation(routeConstructor)
        const handlerSymbol = routeConstructorType.getProperty('handler')
        if (!handlerSymbol) {
          ctx.log('warn', 'Could not get the type of handler()')
          return
        }
        const handlerType = ctx.checker.getTypeOfSymbolAtLocation(
          handlerSymbol,
          routeConstructor
        )
        const handlerParamTypes = handlerType
          .getCallSignatures()
          .flatMap((sig) => sig.getParameters())
          .flatMap((param) =>
            ctx.checker.getTypeOfSymbolAtLocation(param, routeConstructor)
          )
        if (handlerParamTypes.length !== 1) {
          ctx.log('warn', 'handler() should have one parameter')
          return
        }
        const routeHandler = handlerParamTypes[0]

        const routeHandlerParamTypes = routeHandler
          .getCallSignatures()
          .flatMap((c) => c.getParameters())
          .map((param) =>
            ctx.checker.getTypeOfSymbolAtLocation(param, routeConstructor)
          )
        if (routeHandlerParamTypes.length !== 1) {
          ctx.log('warn', 'Route handler should have one parameter')
          return
        }
        const reqType = routeHandlerParamTypes[0]

        ;[body, query, headers, routeParams, cookies] = [
          'body',
          'query',
          'headers',
          'routeParams',
          'cookies',
        ].map((property) =>
          getPropertyType(ctx.checker, routeConstructor, reqType, property)
        )
        requestNode = routeConstructor
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
  return {
    method,
    path,
    requestNode,
    body,
    query,
    headers,
    routeParams,
    cookies,
  }
}

const getResponseTypes = (
  ctx: Context,
  symbol: ts.Symbol
): OpenAPIV3.ResponsesObject | undefined => {
  const descriptions = getResponseDescriptions(symbol)
  const location = symbol.valueDeclaration
  if (!location) return

  const routeType = ctx.checker.getTypeOfSymbolAtLocation(symbol, location)

  // interface Route<Response> {
  //   ...
  //   routeHandler: (req: unknown) => Promise<Response>
  // }
  //
  // We want to dig out the type of `Response`.

  const routeHandlerSymbol = routeType.getProperty('routeHandler')
  if (!routeHandlerSymbol) {
    ctx.log('warn', 'Not a valid route: No routeHandler method')
    return
  }
  const routeHandlerType = ctx.checker.getTypeOfSymbolAtLocation(
    routeHandlerSymbol,
    location
  )
  const returnTypes = routeHandlerType
    .getCallSignatures()
    .map((c) => c.getReturnType())
  if (returnTypes.length !== 1) {
    ctx.log('warn', 'Not a valid route: Invalid routeHandler return type')
    return
  }

  // returnType is a Promise
  const responseType = getPromisePayloadType(
    withLocation(ctx, location),
    returnTypes[0]
  )
  if (!responseType) {
    ctx.log('warn', 'Not a valid route: routeHandler does not return a promise')
    return
  }

  const result: OpenAPIV3.ResponsesObject = {}
  if (isObjectType(responseType)) {
    const responseDef = getResponseDefinition(ctx, descriptions, responseType)
    if (responseDef) result[responseDef.status] = responseDef.response
  } else if (responseType.isUnion()) {
    responseType.types.forEach((type) => {
      const responseDef = getResponseDefinition(ctx, descriptions, type)
      if (responseDef) result[responseDef.status] = responseDef.response
    })
  }

  if (Object.keys(result).length === 0) {
    // Any response types could not be determined so this is not a valid route after all
    return
  }

  return result
}

const getResponseDescriptions = (
  symbol: ts.Symbol
): Partial<Record<string, string>> =>
  Object.fromEntries(
    symbol
      .getJsDocTags()
      .filter((tag) => tag.name === 'response')
      .flatMap((tag) => tag.text)
      .filter(isDefined)
      .flatMap((symbolDisplayPart) => symbolDisplayPart.text)
      .map((text) => {
        const match = /(\d{3}) (.+)/.exec(text)
        if (!match) return undefined
        return [match[1], match[2]] as const
      })
      .filter(isDefined)
  )

const getResponseDefinition = (
  ctx: Context,
  responseDescriptions: Partial<Record<string, string>>,
  responseType: ts.Type
): { status: string; response: OpenAPIV3.ResponseObject } | undefined => {
  const statusSymbol = responseType.getProperty('status')
  const bodySymbol = responseType.getProperty('body')
  const headersSymbol = responseType.getProperty('headers')
  if (
    !statusSymbol?.valueDeclaration ||
    !bodySymbol?.valueDeclaration ||
    !headersSymbol?.valueDeclaration
  )
    return

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

  const status = ctx.checker.typeToString(statusType)

  if (!isNumberLiteralType(statusType)) {
    ctx.log('warn', `Status code is not a number literal: ${status}`)
    return
  }

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

  let description = responseDescriptions[status]
  if (!description) {
    description = statuses.message[parseInt(status)]
    if (!description) {
      ctx.log('warn', `No description for response ${status}`)
      description = status
    }
  }

  return {
    status,
    response: {
      description,
      ...(bodySchema
        ? {
            content:
              isStringType(bodyType) || isNumberType(bodyType)
                ? { 'text/plain': { schema: bodySchema } }
                : isBufferType(bodyType)
                ? { 'application/octet-stream': { schema: bodySchema } }
                : { 'application/json': { schema: bodySchema } },
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
  return props.map((prop): OpenAPIV3.ParameterObject => {
    const description = getDescriptionFromComment(ctx, prop)
    return {
      name: prop.name,
      in: in_,
      required: in_ === 'path' ? true : !isOptional(prop),
      ...(description ? { description } : undefined),
    }
  })
}

interface Headers {
  [header: string]: OpenAPIV3.HeaderObject
}

const typeToHeaders = (ctx: Context, type: ts.Type): Headers => {
  const result: Headers = {}
  const props = ctx.checker.getPropertiesOfType(type)
  props.forEach((prop) => {
    result[prop.name] = {
      required: !isOptional(prop),
    }
  })
  return result
}

interface BaseSchema {
  description?: string
  nullable?: boolean
}

const getBaseSchema = (
  ctx: Context,
  symbol: ts.Symbol | undefined
): BaseSchema => {
  const description = symbol ? getDescriptionFromComment(ctx, symbol) : ''
  return { ...(description ? { description } : undefined) }
}

const typeToSchema = (
  ctx: Context,
  type: ts.Type,
  options: { symbol?: ts.Symbol; optional?: boolean } = {}
): OpenAPIV3.SchemaObject | undefined => {
  let base = getBaseSchema(ctx, options.symbol)

  if (type.isUnion()) {
    let elems = type.types

    if (options.optional) {
      elems = type.types.filter((elem) => !isUndefinedType(elem))
    }

    if (elems.some(isNullType)) {
      // One of the union elements is null
      base = { ...base, nullable: true }
      elems = elems.filter((elem) => !isNullType(elem))
    }

    if (elems.every(isBooleanLiteralType)) {
      // All elements are boolean literals => boolean
      return { type: 'boolean', ...base }
    } else if (elems.every(isNumberLiteralType)) {
      // All elements are number literals => enum
      return {
        type: 'number',
        enum: elems.map((elem) => elem.value),
        ...base,
      }
    } else if (elems.every(isStringLiteralType)) {
      // All elements are string literals => enum
      return {
        type: 'string',
        enum: elems.map((elem) => elem.value),
        ...base,
      }
    } else if (elems.length >= 2) {
      // 2 or more types remain => anyOf
      return {
        anyOf: elems.map((elem) => typeToSchema(ctx, elem)).filter(isDefined),
        ...base,
      }
    } else {
      // Only one element left in the union. Fall through and consider it as the
      // sole type.
      type = elems[0]
    }
  }

  if (isArrayType(type)) {
    const elemType = type.getNumberIndexType()
    if (!elemType) {
      ctx.log('warn', 'Could not get array element type')
      return
    }
    const elemSchema = typeToSchema(ctx, elemType)
    if (!elemSchema) return

    return { type: 'array', items: elemSchema, ...base }
  }

  if (isDateType(type)) {
    // TODO: dates are always represented as date-time strings. It should be
    // possible to override this.
    return { type: 'string', format: 'date-time', ...base }
  }

  if (isBufferType(type)) {
    return { type: 'string', format: 'binary', ...base }
  }

  if (
    isObjectType(type) ||
    (type.isIntersection() && type.types.every((part) => isObjectType(part)))
  ) {
    const props = ctx.checker.getPropertiesOfType(type)
    return {
      type: 'object',
      required: props
        .filter((prop) => !isOptional(prop))
        .map((prop) => prop.name),
      ...base,
      properties: Object.fromEntries(
        props
          .map((prop) => {
            const propType = ctx.checker.getTypeOfSymbolAtLocation(
              prop,
              ctx.location
            )
            if (!propType) {
              ctx.log('warn', 'Could not get type for property', prop.name)
              return
            }
            const propSchema = typeToSchema(ctx, propType, {
              symbol: prop,
              optional: isOptional(prop),
            })
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

  if (isStringType(type)) {
    return { type: 'string', ...base }
  }
  if (isNumberType(type)) {
    return { type: 'number', ...base }
  }
  if (isBooleanType(type)) {
    return { type: 'boolean', ...base }
  }
  if (isStringLiteralType(type)) {
    return { type: 'string', enum: [type.value], ...base }
  }
  if (isNumberLiteralType(type)) {
    return { type: 'number', enum: [type.value], ...base }
  }

  const branded = getBrandedType(ctx, type)
  if (branded) {
    // io-ts branded type
    const { brandName, brandedType } = branded

    if (brandName === 'Brand<IntBrand>') {
      // io-ts Int
      return { type: 'integer', ...base }
    }

    // other branded type
    return typeToSchema(ctx, brandedType, options)
  }

  ctx.log('warn', `Ignoring an unknown type: ${ctx.checker.typeToString(type)}`)
  return
}
