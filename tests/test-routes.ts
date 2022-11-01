import {
  applyMiddleware,
  Parser,
  Response,
  Route,
  route,
  router,
} from 'typera-express'
import * as t from 'io-ts'
import {
  DateFromISOString,
  IntFromString,
  NonEmptyString,
  NumberFromString,
} from 'io-ts-types'
import otherFileDefaultExport, { otherFileExport } from './exported-routes'
import { formUrlEncodedMiddleware } from './middlewares'

/**
 * No input, static output, has a tag
 *
 * @tags Tag
 * @summary This is a summary
 * @operationId getConstant
 * @response 200 Successful result
 */
const constant: Route<Response.Ok<string>> = route
  .get('/constant')
  .handler(async () => {
    return Response.ok('bar')
  })

// Direct route() call
const directRouteCall: Route<Response.Ok<string>> = route(
  'get',
  '/direct-route-call'
).handler(async () => {
  return Response.ok('bar')
})

// Request body and multiple response types
const codec = t.intersection([
  t.type({
    str: t.string,
    requiredBool: t.boolean,
    nullableNum: t.union([t.number, t.null]),
    nullableObj: t.union([
      t.type({
        foo: t.number,
      }),
      t.null,
    ]),
    numLit: t.literal(42),
    numLits: t.union([t.literal(42), t.literal(123)]),
    strLit: t.literal('foo'),
    strLits: t.union([t.literal('foo'), t.literal('bar')]),
    date: DateFromISOString,
  }),
  t.partial({ optionalBool: t.boolean }),
])

/**
 * This one has request body and two possible successful responses and multiple tags
 * @tags Tag1,Tag2
 * @tags Tag3, Tag4
 * @tags Tag5
 * @response 200 Successful result
 * @response 201 A new resource was created
 * @response 400 Validation error
 */
const requestBody: Route<
  Response.Ok<string> | Response.Created | Response.BadRequest<string>
> = route
  .post('/request-body')
  .use(Parser.body(codec))
  .handler(async (request) => {
    if (request.body.optionalBool) {
      return Response.ok(request.body.str)
    } else {
      return Response.created()
    }
  })

// Response body is a custom interface
interface User {
  shoeSize: number
  petName: string | null
  updated: Date
}

const interfaceResponse: Route<Response.Ok<User>> = route
  .get('/interface-response')
  .handler(async () => {
    return Response.ok({ shoeSize: 10, petName: 'John', updated: new Date() })
  })

const interfaceArrayResponse: Route<Response.Ok<User[]>> = route
  .get('/interface-array-response')
  .handler(async () => {
    return Response.ok([
      { shoeSize: 10, petName: 'John', updated: new Date() },
      { shoeSize: 9, petName: 'Milly', updated: new Date() },
    ])
  })

// The route type is not explicitly declared
const noExplicitRouteType = route
  .get('/no-explicit-route-type')
  .handler(async () => {
    return Response.ok('quux')
  })

// The handler's request parameter is unused
const unusedRequest: Route<Response.Ok<string>> = route
  .get('/unused-request')
  .handler(async (_request) => {
    return Response.ok('xyzzy')
  })

// Query parser
const queryCodec = t.intersection([
  t.type({ str: t.string }),
  t.partial({ num: NumberFromString }),
])

const query: Route<Response.Ok<string> | Response.BadRequest<string>> = route
  .get('/query')
  .use(Parser.query(queryCodec))
  .handler(async (request) => {
    return Response.ok(request.query.str)
  })

// Route params
const routeParams: Route<Response.Ok<{ id: number; other: string }>> = route
  .get('/user/:id(int)/:other')
  .handler(async (request) => {
    return Response.ok({
      id: request.routeParams.id,
      other: request.routeParams.other,
    })
  })

// Cookies
const cookiesCodec = t.intersection([
  t.strict({ foo: t.string }),
  t.partial({ bar: NumberFromString }),
])
const cookies: Route<
  Response.Ok<{ foo: string; bar?: number }> | Response.BadRequest<string>
> = route
  .get('/cookies')
  .use(Parser.cookies(cookiesCodec))
  .handler(async (request) => {
    return Response.ok(request.cookies)
  })

// Request body has a branded type
const brandedCodec = t.type({
  int: IntFromString,
  nonEmptyString: NonEmptyString,
})

const brandedRequestBody: Route<
  Response.Ok<number> | Response.BadRequest<string>
> = route
  .post('/branded-request-body')
  .use(Parser.body(brandedCodec))
  .handler(async (request) => {
    return Response.ok(request.body.int)
  })

// Request headers
const requestHeaders: Route<Response.Ok<string> | Response.BadRequest<string>> =
  route
    .get('/request-headers')
    .use(
      Parser.headers(
        t.intersection([
          t.type({ 'API-KEY': t.string }),
          t.partial({ 'X-Forwarded-For': t.string }),
        ])
      )
    )
    .handler(async (_request) => Response.ok('foo'))

// Response headers
const responseHeaders: Route<
  Response.Ok<string, { 'X-Foo': string; 'X-Bar'?: string }>
> = route.get('/response-headers').handler(async () => {
  return Response.ok('yep', { 'X-Foo': 'foo', 'X-Bar': 'bar' })
})

// Custom route function
const customRoute = () => applyMiddleware()
const usesCustomRoute: Route<Response.Ok<string>> = customRoute()
  .get('/uses-custom-route')
  .handler(async () => {
    return Response.ok('foo')
  })

// Docstrings in input/output schemas
const documentedCodec = t.type({
  /** Input field description */
  inputField: t.number,
})

const documentedQuery = t.type({
  /** Foo bar baz */
  param: t.string,
})

interface DocumentedInterface {
  /** Output field description here */
  outputField: string
}

const schemaDocstrings: Route<
  Response.Ok<DocumentedInterface> | Response.BadRequest<string>
> = route
  .get('/schema-docstrings')
  .use(Parser.body(documentedCodec), Parser.query(documentedQuery))
  .handler(async (request) => {
    return Response.ok({
      outputField: request.body.inputField + request.query.param,
    })
  })

// Binary response body
const binaryResponse: Route<Response.Ok<Buffer>> = route
  .get('/binary-response')
  .handler(async () => Response.ok(Buffer.from('hello', 'utf-8')))

// Multiple methods in the same path
const samePathRoute1: Route<Response.Ok<{ foo: string }>> = route
  .get('/same-path-route')
  .handler(async () => Response.ok({ foo: 'hello' }))

const samePathRoute2: Route<Response.Ok<{ bar: number }>> = route
  .post('/same-path-route')
  .handler(async () => Response.ok({ bar: 42 }))

// Route handler not inline

const nonInlineHandler = () => {
  return Response.ok('hello')
}

const handlerNotInline: Route<
  Response.Ok<string> | Response.BadRequest<string>
> = route
  .post('/handler-not-inline')
  // The handler doesn't use the body, but it should still be in the openapi defs
  .use(Parser.body(t.type({ foo: t.string })))
  .handler(nonInlineHandler)

// Route type is a type alias
type GetHandler = Route<Response.Ok<string> | Response.BadRequest<string>>

const typeAlias: GetHandler = route.get('/type-alias').handler(() => {
  if (Math.random() > 0.5) {
    return Response.ok('foo')
  } else {
    return Response.badRequest('bar')
  }
})

const withContentTypeMiddleware: Route<
  Response.Ok<string> | Response.BadRequest<string>
> = route
  .post('/with-content-type-middleware')
  .use(formUrlEncodedMiddleware)
  .use(Parser.body(t.type({ a: t.string })))
  .handler(async (request) => {
    return Response.ok(request.body.a)
  })

interface DirectRecursiveType {
  id: string
  children: DirectRecursiveType[]
}

type DirectRecursiveIntersection = { id: string } & {
  children: DirectRecursiveIntersection
}

interface IndirectRecursiveType {
  hello: string
  items: MutuallyRecursive[]
}

interface MutuallyRecursive {
  other: IndirectRecursiveType
}

const recursiveTypes: Route<
  | Response.Ok<DirectRecursiveType>
  | Response.Ok<DirectRecursiveIntersection>
  | Response.Ok<IndirectRecursiveType>
> = route.get('/recursive-types').handler(async () => {
  return Response.ok({ id: 'hell', children: [] })
})

const responseBodyNumber: Route<Response.Ok<number>> = route
  .get('/response-body-number')
  .handler(async () => {
    return Response.ok(42)
  })

const responseBodyBoolean: Route<Response.Ok<boolean>> = route
  .get('/response-body-boolean')
  .handler(async () => {
    return Response.ok(true)
  })

const responseBodyBuffer: Route<Response.Ok<Buffer>> = route
  .get('/response-body-buffer')
  .handler(async () => {
    return Response.ok(Buffer.from('foo'))
  })

const responseBodyStreaming: Route<Response.Ok<Response.StreamingBody>> = route
  .get('/response-body-streaming')
  .handler(async () => {
    return Response.ok(Response.streamingBody((stream) => stream.write(null)))
  })

const customContentType: Route<
  Response.Ok<string, { 'Content-Type': 'text/csv' }>
> = route.get('/custom-content-type').handler(async () => {
  return Response.ok('foo;bar;baz', { 'Content-Type': 'text/csv' })
})

export default router(
  constant,
  directRouteCall,
  requestBody,
  interfaceResponse,
  interfaceArrayResponse,
  noExplicitRouteType,
  unusedRequest,
  query,
  routeParams,
  cookies,
  brandedRequestBody,
  requestHeaders,
  responseHeaders,
  usesCustomRoute,
  schemaDocstrings,
  binaryResponse,
  samePathRoute1,
  samePathRoute2,
  handlerNotInline,
  typeAlias,
  withContentTypeMiddleware,
  recursiveTypes,
  responseBodyNumber,
  responseBodyBoolean,
  responseBodyBuffer,
  responseBodyStreaming,
  customContentType,
  otherFileExport, // export from another module
  otherFileDefaultExport // default export from another module
)
