import { Route, Response, route, router } from 'typera-express'

const nonLiteralStatus: Route<Response.Response<number, string, any>> = route
  .get('/constant')
  .handler(async () => {
    return Response.ok('bar')
  })

export default router(nonLiteralStatus)
