import { Route, Response, route, router } from 'typera-express'

interface Message {
  message: string
}

const routeOne: Route<Response.Ok<Message>> = route
  .get('/one')
  .handler(async () => {
    return Response.ok({ message: 'one' })
  })

/**
 * @operationId routeOne
 */
const routeTwo: Route<Response.Ok<Message>> = route
  .get('/two')
  .handler(async () => {
    return Response.ok({ message: 'two' })
  })

export default router(routeOne, routeTwo)
