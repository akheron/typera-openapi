import { generate } from '.'
import { Logger } from './context'

const log: Logger = (location, level, ...args) =>
  console.log(`${location}: ${level}:`, ...args)

function main() {
  const args = process.argv.slice(2)
  const result = generate(args, { strict: true }, { log })
  result.forEach(({ fileName, paths }) => {
    console.log(fileName)
    console.log(JSON.stringify(paths, null, 2))
  })
}

main()
