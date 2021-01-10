import { Parser, Response, Route, route, router } from 'typera-express'
import * as t from 'io-ts'
import { NumberFromString } from 'io-ts-types'

// No input and static output
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
  }),
  t.partial({ optionalBool: t.boolean }),
])

const requestBody: Route<
  Response.Ok<string> | Response.Created | Response.BadRequest<string>
> = route
  .post('/request-body')
  .use(Parser.body(codec))
  .handler(async request => {
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
}

const interfaceResponse: Route<Response.Ok<User>> = route
  .get('/interface-response')
  .handler(async () => {
    return Response.ok({ shoeSize: 10, petName: 'John' })
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  .handler(async request => {
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
  .handler(async request => {
    return Response.ok(request.query.str)
  })

// Route params
const routeParams: Route<Response.Ok<{ id: number }>> = route
  .get('/user/:id(int)')
  .handler(async request => {
    return Response.ok({ id: request.routeParams.id })
  })

// Request body has a branded type
// const brandedCodec = t.type({ param: IntFromString })

// const brandedRequestBody: Route<
//   Response.Ok<number> | Response.BadRequest<string>
// > = route
//   .post('/branded-request-body')
//   .use(Parser.body(brandedCodec))
//   .handler(async request => {
//     return Response.ok(request.body.param)
//   })

// Response headers
const responseHeaders: Route<
  Response.Ok<string, { 'X-Foo': string; 'X-Bar'?: string }>
> = route.get('/response-headers').handler(async () => {
  return Response.ok('yep', { 'X-Foo': 'foo', 'X-Bar': 'bar' })
})

export default router(
  constant,
  directRouteCall,
  requestBody,
  interfaceResponse,
  noExplicitRouteType,
  unusedRequest,
  query,
  routeParams,
  // brandedRequestBody,
  responseHeaders
)
