# typera-openapi - typera to OpenAPI generator

![Build](https://github.com/akheron/typera-openapi/workflows/tests/badge.svg)

`typera-openapi` is an experimental tool that creates [OpenAPI v3] definitions
from a project that uses [typera] for routes.

## Getting started

Install typera-openapi:

```sh
npm install typera-openapi
```

Your route files must have a single default export that exports a typera router.
JSDoc comments serve as additional documentation:

```typescript
import { Route, route, router } from 'typera-express'

/**
 * The JSDoc text is used as a description for the route (optional).
 *
 * @tags Tag1,Tag2
 * @summary You can also set a short summary
 * @response 200 Success response description.
 * @response 400 Another description for a response. This one
 * spans multile lines.
 */
const myRoute: Route<Response.Ok<string> | Response.BadRequest<string>> =
  route.get(...).handler(...)

// ...

export default router(myRoute, ...)
```

In the OpenAPI v3 spec, the `description` field of a
[Response Object](https://github.com/OAI/OpenAPI-Specification/blob/master/versions/3.0.3.md#responseObject)
is required, so `typera-openapi` prints a warning if a JSDoc tag for a response
is not found.

Run the `typera-openapi` tool giving paths to your route files as command line
arguments. Assuming you have two route files in your project:

```sh
npx typera-openapi src/routes/foo.ts src/routes/bar.ts
```

This creates `src/routes/foo.openapi.ts` and `src/routes/bar.openapi.ts` which
contain the OpenAPI definitions.

Use the definitions in your app to serve documentation:

```typescript
// This is src/app.ts
import * as express from 'express'
import { OpenAPIV3 } from 'openapi-types'
import * as swaggerUi from 'swagger-ui-express'
import { prefix } from 'typera-openapi'

import foo from './routes/foo'
import fooDefs from './routes/foo.openapi'
import bar from './routes/bar'
import barDefs from './routes/bar.openapi'

const openapiDoc: OpenAPIV3.Document = {
  openapi: '3.0.0',
  info: {
    title: 'My cool API',
    version: '0.1.0',
  },
  paths: {
    ...prefix('/foo', fooDefs.paths),
    ...prefix('/bar', barDefs.paths),
  },
}

const app = express()
app.use('/foo', foo.handler())
app.use('/bar', bar.handler())
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiDoc))

app.listen(3000, () => {
  console.log('Listening on 127.0.0.1:3000')
})
```

The `prefix` function is used to move OpenAPI path definitions to a different
prefix, because the `foo` and `bar` routes are served from their respecive
prefixes.

## Releasing

```
$ yarn version --new-version <major|minor|patch>
$ yarn publish
$ git push origin main --tags
```

Open https://github.com/akheron/typera-openapi/releases, edit the draft release,
select the newest version tag, adjust the description as needed.

[openapi v3]: https://swagger.io/specification/
[typera]: https://github.com/akheron/typera
