import * as ts from 'typescript'
import { Context } from './context'

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
const duckTypeChecker =
  (name: string, properties: string[]) => (type: ts.Type) => {
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

export const getBrandedType = (
  ctx: Context,
  type: ts.Type
): { brandName: string; brandedType: ts.Type } | undefined => {
  if (!type.isIntersection() || type.types.length !== 2) return undefined

  const brandIndex = type.types.findIndex(
    (t) => t.symbol?.escapedName === 'Brand'
  )
  if (brandIndex === -1) return undefined

  const brand = type.types[brandIndex]
  const brandName = ctx.checker.typeToString(brand)
  const brandedType = type.types[brandIndex === 1 ? 0 : 1]

  return { brandName, brandedType }
}

export const getPromisePayloadType = (
  ctx: Context,
  type: ts.Type
): ts.Type | undefined => {
  // Find out the payload type from `then`'s first parameter.
  if (type.symbol.escapedName !== 'Promise') return

  const thenSymbol = type.getProperty('then')
  if (!thenSymbol) return
  const thenType = ctx.checker.getTypeOfSymbolAtLocation(
    thenSymbol,
    ctx.location
  )

  const thenParamType = thenType
    .getCallSignatures()
    .flatMap((c) => c.getParameters())
    .map((c) => ctx.checker.getTypeOfSymbolAtLocation(c, ctx.location))[0]

  if (!thenParamType) return

  const onResolvedType = thenParamType.isUnion()
    ? thenParamType.types.find((t) => !isUndefinedType(t) && !isNullType(t))
    : thenParamType
  if (!onResolvedType) return

  const onResolvedArgTypes = onResolvedType
    .getCallSignatures()
    .flatMap((c) => c.getParameters())
    .map((c) => ctx.checker.getTypeOfSymbolAtLocation(c, ctx.location))

  if (onResolvedArgTypes.length === 0) return

  return onResolvedArgTypes[0]
}
