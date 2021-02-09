import * as ts from 'typescript'

export const isDefined = <T>(value: T | undefined): value is T =>
  value !== undefined

export const isOptional = (symbol: ts.Symbol): boolean =>
  !!(symbol.flags & ts.SymbolFlags.Optional)
export const isArrayType = (type: ts.Type): boolean =>
  type.symbol?.escapedName === 'Array'
export const isObjectType = (type: ts.Type): boolean =>
  !!(type.flags & ts.TypeFlags.Object)
export const isStringType = (type: ts.Type): boolean =>
  !!(type.flags & ts.TypeFlags.String)
export const isNumberType = (type: ts.Type): boolean =>
  !!(type.flags & ts.TypeFlags.Number)
export const isBooleanType = (type: ts.Type): boolean =>
  !!(type.flags & ts.TypeFlags.Boolean)
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

// Check for a specific object type based on type name and property names
const duckTypeChecker = (name: string, properties: string[]) => (
  type: ts.Type
) => {
  const symbol = type.symbol
  return (
    isObjectType(type) &&
    symbol.escapedName === name &&
    // If it walks like a duck and it quacks like a duck, then it must be a duck
    properties.every((name) => symbol.members?.has(name as ts.__String))
  )
}

export const isDateType = duckTypeChecker('Date', [
  'getTime',
  'getFullYear',
  'getDate',
  'setMilliseconds',
  'setHours',
  'setFullYear',
])

export const isBufferType = duckTypeChecker('Buffer', [
  'equals',
  'fill',
  'readUInt8',
  'write',
])

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
