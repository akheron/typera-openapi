# typera-openapi - OpenAPI generator for typera

[![Build](https://github.com/akheron/typera-openapi/actions/workflows/tests.yml/badge.svg?branch=main)](https://github.com/akheron/typera-openapi/actions/workflows/tests.yml)

`typera-openapi` is an tool that automatically creates [OpenAPI v3] definitions
for projects that use [typera] for routes.

Upgrading to v2? See the [upgrading instructions](docs/upgrading.md).

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

## Table of Contents

- [Getting started](#getting-started)
- [CLI](#cli)
- [How it works?](#how-it-works)
  - [The `Date` type](#the-date-type)
- [Reference](#reference)
- [Releasing](#releasing)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

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
  /** The JSDoc text is used as a description for object properties */
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
 * @routeParam myRouteParam Description for route parameter
 *
 * @response 200 Success response description.
 * @response 400 Another description for a response. This one
 * spans multile lines.
 */
const myRoute: Route<Response.Ok<MyResult> | Response.BadRequest<string>> =
  route.post(...).use(Parser.body(bodyCodec)).handler(...)

// ...

/**
 * @prefix /api
 * @tags Tag3
 */
export default router(myRoute, ...)

// The optional @prefix JSDoc tag prepends the prefix to all route paths.
// Tags from router are added to all its routes.
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
import openapi from './openapi'

const openapiDoc: OpenAPIV3.Document = {
  openapi: '3.0.0',
  info: {
    title: 'My cool API',
    version: '0.1.0',
  },
  ...openapi,
}

const app = express()
app.use('/api', myRoutes.handler())
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiDoc))
app.listen(3000)
```

## CLI

```
typera-openapi [options] FILE...
```

Generate OpenAPI definitions for routes found in the given files.

Options:

`-o OUTFILE`, `--outfile OUTFILE`

Output file name. Must end in either `.ts` or `.json`.

`--prettify`, `-p`

Apply [prettier] formatting to output files.

`--check`, `-c`

Check that the output file is up-to-date without actually writing it. If the
file is outdated, print an error and exit with status 1. Useful for CI.

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

So the JSON input this route expects is:

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

## Reference

Terms:

- Route means an OpenAPI operation, i.e. an endpoint you can request.
- `route` is the typera object that lets you create routes, see
  [the docs](https://akheron.github.io/typera/apiref/#route).
- Route handler is the function passed to `.handler()` when defining a route
- `request` is the sole parameter of the route handler function.
- Route type is the type of the route variable returned by `route.get()` etc.
- Router is the value returned by `router()`.

For each route, typera-openapi determines the following information:

| Information  | Source                                                                                  |
| ------------ | --------------------------------------------------------------------------------------- |
| method       | Which `route` method is called, e.g. `route.get()`                                      |
| path         | The parameter of e.g. `route.get()`                                                     |
| summary      | JSDoc comment's `@summary` tag                                                          |
| description  | JSDoc comment's text                                                                    |
| tags         | JSDoc comment's `@tags`                                                                 |
| operationId  | Name of the variable that holds the route, override with JSDoc comment's `@operationId` |
| parameters   | See table below                                                                         |
| request body | See table below                                                                         |
| responses    | See table below                                                                         |

The JSDoc comment of the router can be used to add information to all its
routes:

| Information | Source                                                |
| ----------- | ----------------------------------------------------- |
| path prefix | JSDoc comment's `@path` tag is prefixed to all routes |
| tags        | JSDoc comment's `@tags` are added to all routes       |

OpenAPI parameters covers all the other input expect the request body:

| Parameter | Source                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------- |
| path      | [Route parameter captures](https://akheron.github.io/typera/apiref/#route-parameter-capturing) |
| query     | The type of `request.query` (the output of `Parser.query` or custom middleware)                |
| header    | The type of `request.headers` (the output of `Parser.headers` or custom middleware)            |
| cookie    | The type of `request.cookies` (the output of `Parser.cookies` or custom middleware)            |

OpenAPI allows different request body types per content type, but typera-openapi
only allows one.

| Body field   | Source                                                                        |
| ------------ | ----------------------------------------------------------------------------- |
| content type | `request.contentType`, or `'application/json'` if not defined                 |
| schema       | The type of `request.body` (the output of `Parser.body` or custom middleware) |

A route can have multiple responses. These are modeled in the route type as
`Route<Response1 | Response2 | ...>`. See
[the docs](https://akheron.github.io/typera/apiref/#responses). Each response
type adds a response to the OpenAPI document.

| Response field | Source                                         |
| -------------- | ---------------------------------------------- |
| status         | Response's `Status` type (number literal type) |
| description    | JSDoc comment's `@response` tag                |
| content type   | See below                                      |
| content schema | Response's `Body` type                         |
| headers        | Response's `Headers` type                      |

Response's content type is determined as follows:

- `text/plain` if the body type is string or number
- `application/octet-stream` for
  [streaming responses](https://akheron.github.io/typera/apiref/#streaming-responses)
- `application/json` otherwise

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
