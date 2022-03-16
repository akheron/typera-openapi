import { Response, route, Route, router } from 'typera-express'

const otherRoute: Route<Response.Ok<string>> = route
  .get('/other-route')
  .handler(() => Response.ok('hello'))

/** @prefix /other-stuff */
export default router(otherRoute)
