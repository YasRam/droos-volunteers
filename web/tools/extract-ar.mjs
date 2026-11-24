// Lists every Arabic text in the source: exact strings and template patterns ({0}, {1}...).
// Output: JSON {"exact": [...], "patterns": [...]} to stdout. Used to build src/i18n/en.json.
import * as ts0 from 'typescript5'
import { readFileSync } from 'node:fs'
const ts = ts0.default ?? ts0
const AR = /[؀-ۿ]/
const norm = (s) => s.replace(/\s+/g, ' ').trim()
const exact = new Set()
const patterns = new Set()
for (const f of process.argv.slice(2)) {
  const sf = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const visit = (n) => {
    if (ts.isImportDeclaration(n)) return
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && AR.test(n.text)) {
      // multi-part strings joined with " · " or newlines render as one text; keep whole + parts
      exact.add(norm(n.text))
    } else if (ts.isJsxText(n) && AR.test(n.text)) {
      exact.add(norm(n.text))
    } else if (ts.isTemplateExpression(n) && AR.test(n.getText())) {
      let p = n.head.text
      n.templateSpans.forEach((s, i) => (p += `{${i}}` + s.literal.text))
      patterns.add(norm(p))
      // the static pieces can also show up alone
      ;[n.head.text, ...n.templateSpans.map((s) => s.literal.text)].forEach((x) => AR.test(x) && exact.add(norm(x)))
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
}
console.log(JSON.stringify({ exact: [...exact].filter(Boolean).sort(), patterns: [...patterns].sort() }, null, 1))
