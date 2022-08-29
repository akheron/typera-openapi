import { Response, route, Route, router } from 'typera-express'

const otherRoute: Route<Response.Ok<string>> = route
  .get('/other-route')
  .handler(() => Response.ok('hello'))

/**
 *  @prefix /other-stuff
 *  @tags TagFromRoute
 */
const routeWithTag: Route<Response.Ok<string>> = route
  .get('/route-with-tag')
  .handler(() => Response.ok('hello again'))

/**
 *  @prefix /other-stuff
 *  @tags TagFromRouter
 */
export default router(otherRoute, routeWithTag)
