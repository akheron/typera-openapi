import { Response, route, Route, router } from 'typera-express'

/**
 * @routeParam myRouteParameter 12345
 */
const routeWithRouteParameterTag: Route<
  Response.Ok<string> | Response.BadRequest<string, undefined>
> = route
  .get('/route-with-route-parameter-tag/:myRouteParameter')
  .handler(() => Response.ok('hello'))

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
export default router(otherRoute, routeWithTag, routeWithRouteParameterTag)
