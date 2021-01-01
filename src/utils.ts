import * as ts from 'typescript'

export const isDefined = <T>(value: T | undefined): value is T =>
  value !== undefined

export const isOptional = (symbol: ts.Symbol): boolean =>
  !!(symbol.flags & ts.SymbolFlags.Optional)
export const isObjectType = (type: ts.Type): boolean =>
  !!(type.flags & ts.TypeFlags.Object)
export const isUndefinedType = (type: ts.Type): boolean =>
  !!(type.flags & ts.TypeFlags.Undefined)

export const getPropertyType = (
  checker: ts.TypeChecker,
  location: ts.Node,
  type: ts.Type,
  propertyName: string
): ts.Type | null => {
  const prop = type.getProperty(propertyName)
  if (!prop) return null
  return checker.getTypeOfSymbolAtLocation(prop, location)
}

export const isPackageSymbol = (
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
