import { Parser, Response, Route, route, router } from 'typera-koa'
import * as t from 'io-ts'

const constant: Route<Response.Ok<string>> = route
  .get('/constant')
  .handler(async () => {
    return Response.ok('bar')
  })

const bodyCodec = t.type({ param: t.string })

const requestBody: Route<
  Response.Ok<string> | Response.BadRequest<string>
> = route
  .post('/request-body')
  .use(Parser.body(bodyCodec))
  .handler(async request => {
    return Response.ok(request.body.param)
  })

interface User {
  shoeSize: number
  petName: string
}

const interfaceResponse: Route<Response.Ok<User>> = route
  .get('/interface-response')
  .handler(async request => {
    return Response.ok({ shoeSize: 10, petName: 'John' })
  })

const noExplicitRouteType = route
  .get('/no-explicit-route-type')
  .handler(async () => {
    return Response.ok('quux')
  })

export default router(
  constant,
  requestBody,
  interfaceResponse,
  noExplicitRouteType
)
