import { Route, Response, route, router } from 'typera-express'

const noResponseDescriptions: Route<Response.Ok<string>> = route
  .get('/constant')
  .handler(async () => {
    return Response.ok('bar')
  })

export default router(noResponseDescriptions)
