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

interface MyResult {
  /** The JSDoc text is used as a description for object fields */
  field: number
}

const bodyCodec = t.type({
  /** Descriptions are also supported in io-ts codecs */
  name: t.string
})

/**
 * Routes can also have a description. Note that descriptions are entirely optional.
 *
 * @summary You can also set a short summary
 * @tags Tag1, Tag2
 *
 * @response 200 Success response description.
 * @response 400 Another description for a response. This one
 * spans multile lines.
 */
const myRoute: Route<Response.Ok<MyResult> | Response.BadRequest<string>> =
  route.post(...).use(Parser.body(bodyCodec)).handler(...)

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

## How it works?

`typera-openapi` uses TypeScript type information to generate OpenAPI
definitions. Methods, paths, route params, query params, request and response
bodies, and request and response headers are determined by looking up the type
information provided by the TypeScript compiler API.

For example, assume we have this route:

```typescript
/**
 * @response 200 User created successfully
 * @response 400 Validation error
 */
const createUser: Route<Response.Ok<User> | Response.BadRequest<string>> = route
  .post('/users')
  .use(Parser.body(createUserBody))
  .handler(async (request) => { ... })
```

- Response descriptions are looked up from the JSDoc comment. Other tags are
  also available.
- Response body and header types are available in the type of the `createUser`
  variable. The explicit type annotation would not even be needed, because the
  compiler can infer the type.
- Method and path are available in the `.post('/users')` call.
- The rest are looked up by inspecting the type of the `request` parameter of
  the route handler function.

This has one caveat: The `request` type must match the _input_ you expect your
user to send. Assume the `createUserBody` codec is like this:

```typescript
const createUserBody = t.type({
  name: t.string,
  shoeSize: t.number,
  allowMarketing: BooleanFromString, // from io-ts-types
})
```

The `name` and `shoeSize` fields are fine, since both `t.string` and `t.number`
map their input type to the same output type. But the `allowMarketing` field is
problematic, since `BooleanFromString` takes a string as an input, but converts
it to `boolean`.

So the JSON input this route expect is:

```typescript
type Input = {
  name: string
  shoeSize: number
  allowMarketing: string
}
```

But the type of `request.body` that the compiler sees is:

```typescript
type Body = {
  name: string
  shoeSize: number
  allowMarketing: boolean
}
```

For this reason, you shouldn't use decoders that change the type of the input
directly. If needed, you should instead add another step for converting the data
from input to the format you expect. This can be achieved with a custom
middleware, for example.

### The `Date` type

JSON doesn't have a native `Date` type. As explained above, when
`typera-openapi` encounters a `Date` type, it doesn't know from which input type
it is parsed, so it uses `string` and sets `format` to `date-time`, because this
is how `JSON.stringify` encodes `Date` objects by default. In the future we may
add a way to override this behavior.

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
