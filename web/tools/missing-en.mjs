// Prints Arabic texts in src/ that have no English in src/i18n/en.json yet.
//   node tools/missing-en.mjs
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
const files = []
const walk = (d) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : /\.tsx?$/.test(f) && files.push(join(d, f))))
walk('src')
const ar = JSON.parse(execFileSync('node', ['tools/extract-ar.mjs', ...files], { maxBuffer: 1 << 26 }).toString())
const en = JSON.parse(readFileSync('src/i18n/en.json', 'utf8'))
const pats = new Set(en.patterns.map((p) => p[0]))
const missing = [...ar.exact.filter((s) => !(s in en.exact)), ...ar.patterns.filter((p) => !pats.has(p) && /[؀-ۿ]/.test(p.replace(/\{\d+\}/g, '')))]
console.log(missing.length ? missing.join('\n') : 'all translated')
