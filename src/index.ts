import * as ts from 'typescript'

const MAX_FLAG_COUNT = 28

const values = new Array(MAX_FLAG_COUNT)
  .fill(undefined)
  .map((_, i) => Math.max(1, 2 << (i - 1)))

function extractFlags(input: number): number[] {
  const flags = []
  for (let i = MAX_FLAG_COUNT; i >= 0; i--) {
    if (input >= values[i]) {
      input -= values[i]
      flags.push(values[i])
    }
    if (input === 0) return flags
  }
  return flags
}

function isObjectType(type: ts.Type): type is ts.ObjectType {
  return extractFlags(type.flags).includes(ts.TypeFlags.Object)
}

const isDefined = <T>(value: T | undefined): value is T => value !== undefined

const generate = (fileNames: string[], options: ts.CompilerOptions): void => {
  let program = ts.createProgram(fileNames, options)
  let checker = program.getTypeChecker()

  for (const sourceFile of program.getSourceFiles()) {
    if (!sourceFile.isDeclarationFile) {
      ts.forEachChild(sourceFile, visit(sourceFile, checker))
    }
  }
}

interface Route {
  variableName: string
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
  if (!ts.isVariableStatement(node)) return
  const routeDeclaration = getRouteDeclaration(
    checker,
    node.declarationList.declarations[0]
  )
  if (routeDeclaration) console.log(routeDeclaration)
}

const getRouteDeclaration = (
  checker: ts.TypeChecker,
  declaration: ts.VariableDeclaration
): Route | undefined => {
  const symbol = checker.getSymbolAtLocation(declaration.name)
  if (!symbol) return

  const responses = getResponseTypes(checker, symbol)
  if (!responses) return

  return { variableName: symbol.getName(), responses }
}

const getResponseTypes = (
  checker: ts.TypeChecker,
  symbol: ts.Symbol
): Response[] | undefined => {
  const type = checker.getTypeOfSymbolAtLocation(
    symbol,
    symbol.valueDeclaration
  )

  // TODO: Check that it's the Route interface from typera, not just something
  // with the correct name
  if (!type.aliasSymbol || type.aliasSymbol.name !== 'Route') return

  const args = type.aliasTypeArguments
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

  if (!extractFlags(statusType.flags).includes(ts.TypeFlags.NumberLiteral)) {
    return
  }

  return {
    status: checker.typeToString(statusType),
    bodyType: checker.typeToString(bodyType),
    headersType: checker.typeToString(headersType),
  }
}

function main() {
  generate(process.argv.slice(2), { strict: true })
}

main()
