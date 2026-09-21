import { readFileSync, writeFileSync } from 'node:fs'

const src = readFileSync(process.argv[2], 'utf8')

// Accessors look like:  function Ft(c,t){return c=c-155,Je()[c]}
const accessorRe = /function\s+([A-Za-z_$][\w$]*)\s*\(\s*([\w$]+)\s*,\s*[\w$]+\s*\)\s*\{\s*return\s+\2\s*=\s*\2\s*-\s*(0x[\da-f]+|\d+)\s*,\s*([A-Za-z_$][\w$]*)\(\)\s*\[\s*\2\s*\]\s*\}/gi

const accessors = new Map()
for (const m of src.matchAll(accessorRe)) {
  accessors.set(m[1], { offset: Number(m[3]), table: m[4] })
}

// Evaluate each string-table function in isolation to get its array.
const tables = new Map()
for (const { table } of accessors.values()) {
  if (tables.has(table)) continue
  const start = src.indexOf(`function ${table}(`)
  if (start === -1) { console.warn(`table ${table} not found`); continue }
  // Walk braces to find the end of the declaration.
  let depth = 0, i = src.indexOf('{', start), end = -1
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) { end = i + 1; break }
  }
  const decl = src.slice(start, end)
  tables.set(table, new Function(`${decl}; return ${table}()`)())
}

// Aliases are scope-local — `const e=Ft` in one function, `const e=_t` in the next — so a
// single global map is wrong. Scan declarations and call sites in source order instead and let
// the most recent binding win: a function always declares its alias before it uses it.
const bindings = new Map([...accessors.keys()].map(k => [k, k]))
const scanRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)(?=\s*[;,)])|\b([A-Za-z_$][\w$]*)\(\s*(0x[\da-f]+|\d+)\s*\)/gi

let replaced = 0, skipped = 0
const out = src.replace(scanRe, (whole, alias, target, name, num) => {
  if (alias) {
    const root = bindings.get(target)
    if (root) bindings.set(alias, root)
    else bindings.delete(alias)   // rebound to something unrelated; stop resolving it
    return whole
  }
  const root = bindings.get(name)
  if (!root) return whole
  const { offset, table } = accessors.get(root)
  const value = tables.get(table)?.[Number(num) - offset]
  if (typeof value !== 'string') { skipped++; return whole }
  replaced++
  return JSON.stringify(value)
})

writeFileSync(process.argv[3], out)
console.log(`accessors: ${[...accessors.keys()].join(', ')}`)
console.log(`tables: ${[...tables].map(([n, a]) => `${n}(${a.length})`).join(', ')}`)
console.log(`bindings tracked: ${bindings.size}`)
console.log(`replaced: ${replaced}   skipped: ${skipped}`)
