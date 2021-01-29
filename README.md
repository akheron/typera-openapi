# typera-openapi - OpenAPI generator for typera

![Build](https://github.com/akheron/typera-openapi/workflows/tests/badge.svg)

`typera-openapi` is an experimental tool that automatically creates [OpenAPI v3]
definitions for projects that use [typera] for routes.

## Getting started

Install typera-openapi:

```sh
npm install typera-openapi
```

Your route files must have a single default export that exports a typera router.
JSDoc comments serve as additional documentation:

```typescript
// src/my-routes.ts

import { Response, Route, route, router } from 'typera-express'

/**
 * The JSDoc text is used as a description for the route (optional).
 *
 * @summary You can also set a short summary
 * @tags Tag1, Tag2
 *
 * @response 200 Success response description.
 * @response 400 Another description for a response. This one
 * spans multile lines.
 */
const myRoute: Route<Response.Ok<string> | Response.BadRequest<string>> =
  route.get(...).handler(...)

// ...

export default router(myRoute, ...)
```

Run the `typera-openapi` tool giving paths to your route files as command line
arguments:

```sh
npx typera-openapi src/my-routes.ts
```

This creates `src/my-routes.openapi.ts` which contains the OpenAPI definitions.

Use the definitions in your app to serve documentation:

```typescript
// src/app.ts

import * as express from 'express'
import { OpenAPIV3 } from 'openapi-types'
import * as swaggerUi from 'swagger-ui-express'
import { prefix } from 'typera-openapi'

import myRoutes from './my-routes'
import myRouteDefs from './my-routes.openapi'

const openapiDoc: OpenAPIV3.Document = {
  openapi: '3.0.0',
  info: {
    title: 'My cool API',
    version: '0.1.0',
  },
  paths: {
    ...prefix('/api', myRouteDefs.paths),
  },
}

const app = express()
app.use('/api', myRoutes.handler())
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiDoc))
app.listen(3000)
```

The `prefix` function is used to move OpenAPI path definitions to a different
prefix, because the `myRoutes` are served from the `/api` prefix.

## CLI

```
typera-openapi [options] FILE...
```

Generate OpenAPI definitions for routes found in the given files.

For each input file `file.ts`, writes a `file.openapi.ts` or
`file.openapi.json`, depending on `--format`.

Options:

`--format`

Output file format. Either `ts` or `json`. Default: `ts`.

`--prettify`, `-p`

Apply [prettier] formatting to output files.

`--check`, `-c`

Check that generated files are up-to-date without actually generating them. If
any file is outdated, print an error and exit with status 1. Useful for CI.

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
[prettier]: https://prettier.io
