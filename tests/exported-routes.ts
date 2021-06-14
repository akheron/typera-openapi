import { Response, Route, route } from 'typera-express'

export const otherFileExport: Route<Response.Ok<string>> = route
  .get('/other-file-export')
  .handler(async () => {
    return Response.ok('hello')
  })

export default route.get('/other-file-default-export').handler(async () => {
  return Response.ok('hello')
})
