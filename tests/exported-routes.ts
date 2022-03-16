import { Response, Route, route } from 'typera-express'

// This interface also exists in test-routes.ts => it should be named `User2` in component schemas.
interface User {
  name: string
}

export const otherFileExport: Route<Response.Ok<User>> = route
  .get('/other-file-export')
  .handler(async () => {
    return Response.ok({ name: 'hello' })
  })

export default route.get('/other-file-default-export').handler(async () => {
  return Response.ok('hello')
})
