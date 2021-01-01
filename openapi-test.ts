import { Parser, Response, Route, route, router } from 'typera-express'
import * as t from 'io-ts'
import { NumberFromString } from 'io-ts-types'

// No input and static output
const constant: Route<Response.Ok<string>> = route
  .get('/constant')
  .handler(async () => {
    return Response.ok('bar')
  })

// Request body and multiple response types
const codec = t.intersection([
  t.type({ str: t.string, requiredBool: t.boolean }),
  t.partial({ optionalBool: t.boolean }),
])

const requestBody: Route<
  Response.Ok<string> | Response.Created<number> | Response.BadRequest<string>
> = route
  .post('/request-body')
  .use(Parser.body(codec))
  .handler(async request => {
    if (request.body.optionalBool) {
      return Response.ok(request.body.str)
    } else {
      return Response.created(42)
    }
  })

// Response body is a custom interface
interface User {
  shoeSize: number
  petName: string
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
  .handler(async request => {
    return Response.ok('xyzzy')
  })

// Query parser
const query: Route<Response.Ok<string> | Response.BadRequest<string>> = route
  .get('/query')
  .use(Parser.query(codec))
  .handler(async request => {
    return Response.ok(request.query.param)
  })

// Route params
const routeParams: Route<Response.Ok<{ id: number }>> = route
  .get('/user/:id(int)')
  .handler(async request => {
    return Response.ok({ id: request.routeParams.id })
  })

// Request body has a branded type
const brandedCodec = t.type({ param: NumberFromString })

const brandedRequestBody: Route<
  Response.Ok<number> | Response.BadRequest<string>
> = route
  .post('/branded-request-body')
  .use(Parser.body(brandedCodec))
  .handler(async request => {
    return Response.ok(request.body.param)
  })

export default router(
  constant,
  requestBody,
  interfaceResponse,
  noExplicitRouteType,
  unusedRequest,
  query,
  routeParams,
  brandedRequestBody
)
