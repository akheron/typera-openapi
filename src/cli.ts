import { generate } from '.'

function main() {
  const args = process.argv.slice(2)
  const result = generate(args, { strict: true })
  result.forEach(({ fileName, paths }) => {
    console.log(fileName)
    console.log(JSON.stringify(paths, null, 2))
  })
}

main()
