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

const isPackageSymbol = (
  symbol: ts.Symbol,
  packageName: string,
  symbolName: string
): boolean => {
  const parent = (symbol.valueDeclaration ?? symbol.declarations[0]).parent
  return (
    symbol.name === symbolName &&
    ts.isSourceFile(parent) &&
    parent.fileName.includes(`/${packageName}/`)
  )
}

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
      if (routeDeclaration) console.log(routeDeclaration)
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

  // TODO: Check for router calls better than just checking the name
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
  const responses = getResponseTypes(checker, symbol)
  if (!responses) return

  return { variableName: symbol.getName(), responses }
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
