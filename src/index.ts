import * as ts from 'typescript'
import { OpenAPIV3 } from 'openapi-types'
import {
  isDefined,
  isOptional,
  isObjectType,
  isUndefinedType,
  isPackageSymbol,
  getPropertyType,
} from './utils'

const generate = (fileNames: string[], options: ts.CompilerOptions): void => {
  const program = ts.createProgram(fileNames, options)
  const checker = program.getTypeChecker()

  for (const sourceFile of program.getSourceFiles()) {
    if (!sourceFile.isDeclarationFile) {
      ts.forEachChild(sourceFile, visit(sourceFile, checker))
    }
  }
}

interface Route {
  variableName: string
  method: string
  path: string
  parameters: OpenAPIV3.ParameterObject[] | undefined
  requestBody: OpenAPIV3.SchemaObject | undefined
  responses: Response[]
}

interface Response {
  status: string
  bodyType: string
  headersType: string
}

const visit = (sourceFile: ts.SourceFile, checker: ts.TypeChecker) => (
  node: ts.Node
) => {
  if (ts.isExportAssignment(node) && !node.isExportEquals) {
    // export default
    const argSymbols = getRouterCallArgSymbols(checker, node.expression)
    if (!argSymbols) return

    argSymbols.forEach(symbol => {
      const routeDeclaration = getRouteDeclaration(checker, symbol)
      if (routeDeclaration) {
        console.log(JSON.stringify(routeDeclaration, null, 2))
      }
    })
  }
}

const getRouterCallArgSymbols = (
  checker: ts.TypeChecker,
  expression: ts.Expression
): ts.Symbol[] | undefined => {
  if (!ts.isCallExpression(expression)) return

  const fn = expression.expression
  const args = expression.arguments

  // TODO: Check for router calls better than just checking the symbol name
  if (!ts.isIdentifier(fn) || fn.escapedText !== 'router') return

  const argSymbols = args
    .filter(ts.isIdentifier)
    .map(arg => checker.getSymbolAtLocation(arg))
    .filter(isDefined)

  if (argSymbols.length === args.length) return argSymbols
}

const getRouteDeclaration = (
  checker: ts.TypeChecker,
  symbol: ts.Symbol
): Route | undefined => {
  const routeInput = getRouteInput(checker, symbol)
  if (!routeInput) return
  const { method, path, requestNode, body, query, routeParams } = routeInput

  const responses = getResponseTypes(checker, symbol)
  if (!responses) return

  const requestBody =
    requestNode && body ? typeToSchema(checker, requestNode, body) : undefined

  const parameters = [
    ...typeToParameters(checker, 'path', routeParams),
    ...typeToParameters(checker, 'query', query),
  ]

  return {
    variableName: symbol.getName(),
    method,
    path,
    parameters: parameters.length > 0 ? parameters : undefined,
    requestBody,
    responses,
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
  checker: ts.TypeChecker,
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
    // const args = expr.arguments
    if (!ts.isPropertyAccessExpression(lhs)) {
      console.warn('TODO: direct route call')
      return
    } else {
      if (!ts.isIdentifier(lhs.name)) return
      const fnName = lhs.name.escapedText.toString()
      if (methodNames.includes(fnName)) {
        method = fnName
        const pathArg = expr.arguments[0]
        if (!pathArg) {
          console.warn(`No argument for method ${fnName}`)
          return
        }
        if (!ts.isStringLiteral(pathArg)) {
          console.warn(`Method ${fnName} argument is not a string literal`)
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
          console.warn('Handler is not a function')
          return
        }
        const req = handlerFn.parameters[0]
        if (req) {
          const type = checker.getTypeAtLocation(req)
          body = getPropertyType(checker, req, type, 'body')
          query = getPropertyType(checker, req, type, 'query')
          routeParams = getPropertyType(checker, req, type, 'routeParams')
          requestNode = req
        }
      }
      expr = lhs.expression
    }
  }
  if (!method) {
    console.warn('Could not determine route method')
    return
  }
  if (!path) {
    console.warn('Could not determine route path')
    return
  }
  if (method === 'all') {
    console.warn("The 'all' method is not supported, skipping route")
    return
  }
  return { method, path, requestNode, body, query, routeParams }
}

const getResponseTypes = (
  checker: ts.TypeChecker,
  symbol: ts.Symbol
): Response[] | undefined => {
  const routeType = checker.getTypeOfSymbolAtLocation(
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

  if (isObjectType(responseType)) {
    const response = getResponseDefinition(checker, responseType)
    if (response) return [response]
  } else if (responseType.isUnion()) {
    const responses = responseType.types
      .map(type => getResponseDefinition(checker, type))
      .filter(isDefined)
    if (responses.length) return responses
  }

  // If we ended down here, the response types could not be determined so this is not a valid route after all
}

const getResponseDefinition = (
  checker: ts.TypeChecker,
  responseType: ts.Type
): Response | undefined => {
  const statusSymbol = responseType.getProperty('status')
  const bodySymbol = responseType.getProperty('body')
  const headersSymbol = responseType.getProperty('headers')
  if (!statusSymbol || !bodySymbol || !headersSymbol) return

  const statusType = checker.getTypeOfSymbolAtLocation(
    statusSymbol,
    statusSymbol.valueDeclaration
  )
  const bodyType = checker.getTypeOfSymbolAtLocation(
    bodySymbol,
    bodySymbol.valueDeclaration
  )
  const headersType = checker.getTypeOfSymbolAtLocation(
    headersSymbol,
    headersSymbol.valueDeclaration
  )
  if (!statusType || !bodyType || !headersType) return

  if (!(statusType.flags & ts.TypeFlags.NumberLiteral)) {
    return
  }

  return {
    status: checker.typeToString(statusType),
    bodyType: checker.typeToString(bodyType),
    headersType: checker.typeToString(headersType),
  }
}

const typeToParameters = (
  checker: ts.TypeChecker,
  in_: 'path' | 'query' | 'header' | 'cookie',
  type: ts.Type | undefined
): OpenAPIV3.ParameterObject[] => {
  if (!type) return []

  const props = checker.getPropertiesOfType(type)
  return props.map(prop => ({
    name: prop.name,
    in: in_,
    required: in_ === 'path' ? true : !isOptional(prop),
  }))
}

const typeToSchema = (
  checker: ts.TypeChecker,
  location: ts.Node,
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
        anyOf: elems
          .map(elem => typeToSchema(checker, location, elem))
          .filter(isDefined),
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
    const props = checker.getPropertiesOfType(type)
    return {
      type: 'object',
      required: props.filter(prop => !isOptional(prop)).map(prop => prop.name),
      properties: Object.fromEntries(
        props
          .map(prop => {
            const propType = checker.getTypeOfSymbolAtLocation(prop, location)
            if (!propType) {
              console.warn('Could not get type for property', prop.name)
              return
            }
            const propSchema = typeToSchema(
              checker,
              location,
              propType,
              isOptional(prop)
            )
            if (!propSchema) {
              console.warn('Could not get schema for property', prop.name)
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

  console.warn('Unknown type, skipping')
  return
}

function main() {
  generate(process.argv.slice(2), { strict: true })
}

main()
