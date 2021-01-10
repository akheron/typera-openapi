import * as ts from 'typescript'

export const isDefined = <T>(value: T | undefined): value is T =>
  value !== undefined

export const isOptional = (symbol: ts.Symbol): boolean =>
  !!(symbol.flags & ts.SymbolFlags.Optional)
export const isObjectType = (type: ts.Type): boolean =>
  !!(type.flags & ts.TypeFlags.Object)
export const isBooleanLiteralType = (type: ts.Type): boolean =>
  !!(type.flags & ts.TypeFlags.BooleanLiteral)
export const isNumberLiteralType = (
  type: ts.Type
): type is ts.NumberLiteralType => !!(type.flags & ts.TypeFlags.NumberLiteral)
export const isStringLiteralType = (
  type: ts.Type
): type is ts.StringLiteralType => !!(type.flags & ts.TypeFlags.StringLiteral)
export const isUndefinedType = (type: ts.Type): boolean =>
  !!(type.flags & ts.TypeFlags.Undefined)
export const isNullType = (type: ts.Type): boolean =>
  !!(type.flags & ts.TypeFlags.Null)

export const getPropertyType = (
  checker: ts.TypeChecker,
  location: ts.Node,
  type: ts.Type,
  propertyName: string
): ts.Type | undefined => {
  const prop = type.getProperty(propertyName)
  if (!prop) return
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
