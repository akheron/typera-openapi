# Upgrading from v1 to v2

In v1, typera-openapi generated one file per source file. In v2, all the OpenAPI
stuff is put to a single file.

Why? Because starting from v2, typera-openapi generates the schemas from
`interface` and `type` alias object types under `components` and uses
`"$ref": "#/components/schemas/TypeName"`. This results in a more concise
output, sometimes more readable API documentation for the end user, and supports
types that are defined recursively (i.e. reference themselves directly or
indirectly).

## Upgrading the CLI options

_Use the `-o`/`--outfile` option to write to a specific file._ The default is
`openapi.ts` in the working directory.

Old:

```
$ typera-openapi src/routes1.ts src/routes2.ts
```

New:

```
$ typera-openapi -o src/openapi.ts src/routes1.ts src/routes2.ts
```

_Remove the `--format` option._ The output format is selected by the output file
suffix. `.ts` writes TypeScript, `.json` writes JSON.

Old:

```
$ typera-openapi --format json src/routes1.ts src/routes2.ts
```

New:

```
$ typera-openapi -o src/openapi.json src/routes1.ts src/routes2.ts
```

## Upgrading your code

Because the output is in a single file, there's no need to merge paths objects
anymore.

Old:

```
import routeDefs from './routes.openapi'
import otherDefs from './others.openapi'

const openapiDoc: OpenAPIV3.Document = {
  openapi: '3.0.0',
  info: {
    title: 'My cool API',
    version: '0.1.0',
  },
  paths: {
    ...routeDefs.paths,
    ...otherDefs.paths
  }
}
```

New:

```
import openapi from './openapi'

const openapiDoc: OpenAPIV3.Document = {
  openapi: '3.0.0',
  info: {
    title: 'My cool API',
    version: '0.1.0',
  },
  ...openapi,
}
```
