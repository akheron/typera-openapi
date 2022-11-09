import * as path from 'path'
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
  isStreamingBodyType,
} from './utils'
import { Components } from './components'

interface GenerateOptions {
  log: Logger
}

export interface GenerateOutput {
  paths: OpenAPIV3.PathsObject
  components: OpenAPIV3.ComponentsObject
}

export interface GenerateResult {
  output: GenerateOutput
  unseenFileNames: string[]
}

export const generate = (
  fileNames: string[],
  compilerOptions: ts.CompilerOptions,
  options?: GenerateOptions
): GenerateResult => {
  const log = options?.log || (() => undefined)
  const program = ts.createProgram(fileNames, compilerOptions)
  const checker = program.getTypeChecker()

  const seenFileNames = new Set<string>()
  const seenOperationIds = new Set<string>()

  const components = new Components()
  let paths: OpenAPIV3.PathsObject = {}

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue

    const foundFile = fileNames.find((fileName) =>
      isSameFile(fileName, sourceFile.fileName)
    )
    if (foundFile === undefined) continue

    let containsRoutes = false
    ts.forEachChild(sourceFile, (node) => {
      const newPaths = visitTopLevelNode(
        context(checker, sourceFile, log, node),
        components,
        seenOperationIds,
        node
      )
      if (newPaths) {
        // TODO: What if a route is defined multiple times?
        paths = { ...paths, ...newPaths }
        containsRoutes = true
      }
    })
    if (containsRoutes) {
      seenFileNames.add(foundFile)
    }
  }

  return {
    output: { paths, components: components.build() },
    unseenFileNames: fileNames.filter(
      (fileName) => !seenFileNames.has(fileName)
    ),
  }
}

const isSameFile = (a: string, b: string) => path.resolve(a) === path.resolve(b)

const visitTopLevelNode = (
  ctx: Context,
  components: Components,
  seenOperationIds: Set<string>,
  node: ts.Node
): OpenAPIV3.PathsObject | undefined => {
  if (ts.isExportAssignment(node) && !node.isExportEquals) {
    const prefix = getRouterPrefix(node)
    const tags = getNodeTags(node)

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
        components,
        symbol
      )
      if (routeDeclaration) {
        const [path, method, operation] = routeDeclaration
        const prefixedPath = prefix + path
        const pathsItemObject = paths[prefixedPath]
        const operationWithRouterTags =
          tags.length > 0
            ? {
                ...operation,
                tags: [...(operation.tags ?? []), ...tags],
              }
            : operation
        if (!pathsItemObject) {
          paths[prefixedPath] = { [method]: operationWithRouterTags }
        } else {
          pathsItemObject[method] = operation
        }

        if (operation.operationId) {
          if (!seenOperationIds.has(operation.operationId)) {
            seenOperationIds.add(operation.operationId)
          } else {
            ctx.log(
              'warn',
              `Duplicated operationId ${operation.operationId}. Use @operationId in JSDoc comment to override.`
            )
          }
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
  components: Components,
  symbol: ts.Symbol
): [string, Method, OpenAPIV3.OperationObject] | undefined => {
  const description = getDescriptionFromComment(ctx, symbol)
  const summary = getRouteSummary(symbol)
  const tags = getSymbolTags(symbol)
  const routeInput = getRouteInput(ctx, symbol)
  const operationId =
    getRouteOperationId(symbol) ?? symbol.escapedName.toString()

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
    contentType,
  } = routeInput

  const contentTypeString =
    contentType && isStringLiteralType(contentType)
      ? ctx.checker.typeToString(contentType).replace(/"/g, '')
      : undefined

  const responses = getResponseTypes(ctx, components, symbol)
  if (!responses) return

  const requestBody =
    requestNode && body
      ? typeToSchema(withLocation(ctx, requestNode), components, body)
      : undefined

  const parameters = [
    ...typeToRequestParameters(ctx, 'path', routeParams),
    ...typeToRequestParameters(ctx, 'query', query),
    ...typeToRequestParameters(ctx, 'header', headers),
    ...typeToRequestParameters(ctx, 'cookie', cookies),
  ]

  const pathTemplate = path.replace(/:([^-.()/]+)(\(.*?\))?/g, '{$1}')

  return [
    pathTemplate,
    method,
    {
      ...(summary ? { summary } : undefined),
      ...{ operationId },
      ...(description ? { description } : undefined),
      ...(tags && tags.length > 0 ? { tags } : undefined),
      ...(parameters.length > 0 ? { parameters } : undefined),
      ...operationRequestBody(requestBody, contentTypeString),
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

const getSymbolTags = (symbol: ts.Symbol): string[] | undefined =>
  symbol
    .getJsDocTags()
    .filter((tag) => tag.name === 'tags')
    .flatMap((tag) => tag.text)
    .filter(isDefined)
    .flatMap((symbolDisplayPart) => symbolDisplayPart.text.split(','))
    .map((tag) => tag.trim())

const getRouteOperationId = (symbol: ts.Symbol): string | undefined =>
  symbol
    .getJsDocTags()
    .filter((tag) => tag.name === 'operationId')
    .flatMap((tag) => tag.text)
    .filter(isDefined)
    .map((symbolDisplayPart) => symbolDisplayPart.text)[0]

const getNodeTags = (node: ts.Node): string[] =>
  ts
    .getJSDocTags(node)
    .filter((tag) => tag.tagName.escapedText === 'tags')
    .flatMap((tag) => (typeof tag.comment === 'string' ? [tag.comment] : []))
    .flatMap((text) => text.split(','))
    .map((tag) => tag.trim())

const getRouterPrefix = (node: ts.Node): string =>
  ts
    .getJSDocTags(node)
    .filter((tag) => tag.tagName.escapedText === 'prefix')
    .flatMap((tag) =>
      typeof tag.comment === 'string' ? [tag.comment] : []
    )[0] ?? ''

const operationRequestBody = (
  contentSchema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject | undefined,
  contentType = 'application/json'
): { requestBody: OpenAPIV3.RequestBodyObject } | undefined => {
  if (!contentSchema) return

  return {
    requestBody: { content: { [contentType]: { schema: contentSchema } } },
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
  contentType: ts.Type | undefined
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
    cookies: ts.Type | undefined,
    contentType: ts.Type | undefined

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

        ;[body, query, headers, routeParams, cookies, contentType] = [
          'body',
          'query',
          'headers',
          'routeParams',
          'cookies',
          'contentType',
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
    contentType,
  }
}

const getResponseTypes = (
  ctx: Context,
  components: Components,
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
    const responseDef = getResponseDefinition(
      ctx,
      components,
      descriptions,
      responseType
    )
    if (responseDef) result[responseDef.status] = responseDef.response
  } else if (responseType.isUnion()) {
    responseType.types.forEach((type) => {
      const responseDef = getResponseDefinition(
        ctx,
        components,
        descriptions,
        type
      )
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
  components: Components,
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

  let bodySchema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject | undefined
  if (!isUndefinedType(bodyType)) {
    bodySchema = typeToSchema(ctx, components, bodyType)
    if (!bodySchema) return
  }

  const headers = !isUndefinedType(headersType)
    ? typeToResponseHeaders(ctx, headersType)
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
            content: {
              [getResponseContentType(ctx, headersType, bodyType)]: {
                schema: bodySchema,
              },
            },
          }
        : undefined),
      ...(headers ? { headers } : undefined),
    },
  }
}

const getResponseContentType = (
  ctx: Context,
  headersType: ts.Type,
  bodyType: ts.Type
): string => {
  const contentTypeHeader = getContentTypeHeader(ctx, headersType)
  if (contentTypeHeader !== undefined) return contentTypeHeader

  if (
    isStringType(bodyType) ||
    isNumberType(bodyType) ||
    isBooleanType(bodyType)
  ) {
    return 'text/plain'
  }

  if (isBufferType(bodyType) || isStreamingBodyType(bodyType)) {
    return 'application/octet-stream'
  }

  return 'application/json'
}

const getContentTypeHeader = (
  ctx: Context,
  headersType: ts.Type
): string | undefined => {
  if (isUndefinedType(headersType) || !headersType.symbol.members) return

  const members = headersType.symbol.members as Map<string, ts.Symbol>
  for (const [name, symbol] of members) {
    if (name.toLowerCase() !== 'content-type') continue

    if (symbol.valueDeclaration) {
      const t = ctx.checker.getTypeOfSymbolAtLocation(
        symbol,
        symbol.valueDeclaration
      )
      if (isStringLiteralType(t)) {
        return t.value
      }
    }

    // Content-Type found but it was not suitable, no point in searching further
    break
  }
}

const typeToRequestParameters = (
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
      schema: { type: 'string' },
      ...(description ? { description } : undefined),
    }
  })
}

interface Headers {
  [header: string]: OpenAPIV3.HeaderObject
}

const typeToResponseHeaders = (ctx: Context, type: ts.Type): Headers => {
  const result: Headers = {}
  const props = ctx.checker.getPropertiesOfType(type)
  props.forEach((prop) => {
    result[prop.name] = {
      schema: { type: 'string' },
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
  components: Components,
  type: ts.Type,
  options: { propSymbol?: ts.Symbol; optional?: boolean } = {}
): OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject | undefined =>
  components.withSymbol(
    type.aliasSymbol ?? type.getSymbol(),
    (addComponent) => {
      let base = getBaseSchema(ctx, options.propSymbol)

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
        }

        if (elems.every(isNumberLiteralType)) {
          // All elements are number literals => enum
          addComponent()
          return {
            type: 'number',
            enum: elems.map((elem) => elem.value),
            ...base,
          }
        } else if (elems.every(isStringLiteralType)) {
          // All elements are string literals => enum
          addComponent()
          return {
            type: 'string',
            enum: elems.map((elem) => elem.value),
            ...base,
          }
        } else if (elems.length >= 2) {
          // 2 or more types remain => anyOf
          addComponent()
          return {
            anyOf: elems
              .map((elem) => typeToSchema(ctx, components, elem))
              .filter(isDefined),
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
        const elemSchema = typeToSchema(ctx, components, elemType)
        if (!elemSchema) return

        return { type: 'array', items: elemSchema, ...base }
      }

      if (isDateType(type)) {
        // TODO: dates are always represented as date-time strings. It should be
        // possible to override this.
        return { type: 'string', format: 'date-time', ...base }
      }

      if (isBufferType(type) || isStreamingBodyType(type)) {
        return { type: 'string', format: 'binary', ...base }
      }

      if (
        isObjectType(type) ||
        (type.isIntersection() &&
          type.types.every((part) => isObjectType(part)))
      ) {
        addComponent()
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
                const propSchema = typeToSchema(ctx, components, propType, {
                  propSymbol: prop,
                  optional: isOptional(prop),
                })
                if (!propSchema) {
                  ctx.log(
                    'warn',
                    'Could not get schema for property',
                    prop.name
                  )
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
        return typeToSchema(ctx, components, brandedType, options)
      }

      ctx.log(
        'warn',
        `Ignoring an unknown type: ${ctx.checker.typeToString(type)}`
      )
      return
    }
  )
