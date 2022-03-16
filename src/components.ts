import * as ts from 'typescript'
import { OpenAPIV3 } from 'openapi-types'
import { isInterface, isTypeAlias } from './utils'

export class Components {
  // undefined acts as a placeholder
  #schemas: Map<string, OpenAPIV3.SchemaObject | undefined>
  #symbolSchemas: Map<ts.Symbol, string>

  constructor() {
    this.#schemas = new Map()
    this.#symbolSchemas = new Map()
  }

  withSymbol(
    symbol: ts.Symbol | undefined,
    run: (
      addComponent: () => void
    ) => OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject | undefined
  ): OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject | undefined {
    const ref = symbol && this.#getRefForSymbol(symbol)
    if (ref) {
      return { $ref: ref }
    }

    if (symbol && (isInterface(symbol) || isTypeAlias(symbol))) {
      let added = false
      const schema = run(() => {
        this.#addSymbol(symbol)
        added = true
      })
      if (added) {
        if (schema === undefined || '$ref' in schema) {
          this.#deleteSymbol(symbol)
          return schema
        } else {
          return { $ref: this.#addSchema(symbol, schema) }
        }
      } else {
        return schema
      }
    } else {
      return run(() => {})
    }
  }

  #getRefForSymbol(symbol: ts.Symbol): string | undefined {
    const schemaName = this.#symbolSchemas.get(symbol)
    return schemaName !== undefined
      ? `#/components/schemas/${schemaName}`
      : undefined
  }

  #addSymbol(symbol: ts.Symbol) {
    if (this.#symbolSchemas.has(symbol)) return

    let name = symbol.name
    for (let i = 2; ; i++) {
      if (this.#schemas.has(name)) {
        name = `${symbol.name}${i}`
      } else {
        break
      }
    }

    this.#schemas.set(name, undefined)
    this.#symbolSchemas.set(symbol, name)
  }

  #deleteSymbol(symbol: ts.Symbol) {
    const name = this.#symbolSchemas.get(symbol)
    if (name === undefined) return

    this.#schemas.delete(name)
    this.#symbolSchemas.delete(symbol)
  }

  #addSchema(symbol: ts.Symbol, schema: OpenAPIV3.SchemaObject): string {
    const name = this.#symbolSchemas.get(symbol)
    if (name === undefined)
      throw new Error(`No schema has been added for symbol ${symbol.name}`)
    this.#schemas.set(name, schema)
    return `#/components/schemas/${name}`
  }

  build(): OpenAPIV3.ComponentsObject {
    const schemas = Object.fromEntries(
      [...this.#schemas.entries()].flatMap(([k, v]) =>
        v !== undefined ? [[k, v]] : []
      )
    )
    return {
      ...(this.#schemas.size > 0 ? { schemas } : undefined),
    }
  }
}
