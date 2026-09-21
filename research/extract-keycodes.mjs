// Pulls the vendor's { value, name } keycode tables out of the deobfuscated protocol chunk.
// Contiguous runs of entries are treated as one table; runs are reported separately because the
// vendor uses several encodings (base keys are small integers, media/combo keys are 32-bit).
import { readFileSync, writeFileSync } from 'node:fs'

const src = readFileSync(process.argv[2] ?? 'proto.clean.js', 'utf8')
const entryRe = /\{\s*value:\s*(\d+),\s*name:\s*"((?:[^"\\]|\\.)*)"\s*\}/g

const groups = []
let current = null
let previousEnd = -1

for (const match of src.matchAll(entryRe)) {
  const gap = match.index - previousEnd
  // Entries in one array literal are separated by ", " — anything larger starts a new table.
  if (!current || gap > 4) {
    current = { start: match.index, entries: [] }
    groups.push(current)
  }
  current.entries.push({ value: Number(match[1]), name: match[2] })
  previousEnd = match.index + match[0].length
}

const tables = groups
  .filter((group) => group.entries.length >= 8)
  .map((group, index) => {
    const values = group.entries.map((entry) => entry.value)
    const names = group.entries.map((entry) => entry.name)
    return {
      index,
      offset: group.start,
      count: group.entries.length,
      minValue: Math.min(...values),
      maxValue: Math.max(...values),
      uniqueValues: new Set(values).size,
      uniqueNames: new Set(names).size,
      entries: group.entries,
    }
  })

writeFileSync('keycode-tables.json', JSON.stringify(tables, null, 2))

console.log(`tables found: ${tables.length}\n`)
for (const table of tables) {
  console.log(
    `#${table.index} @${table.offset}  count=${table.count}  ` +
      `values ${table.minValue}..${table.maxValue}  ` +
      `uniqueValues=${table.uniqueValues} uniqueNames=${table.uniqueNames}`,
  )
  console.log('   ' + table.entries.slice(0, 6).map((e) => `${e.value}=${e.name}`).join(', '))
}
