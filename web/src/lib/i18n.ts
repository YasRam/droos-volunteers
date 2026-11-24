// Arabic / English.
//
// The app is written in Arabic. In English mode, every Arabic text on screen is swapped for its
// English translation from src/i18n/en.json as it appears (text nodes and a few attributes).
// Only what is shown changes: values, data and logic stay Arabic, so nothing else in the code
// needs to know about the language. Names and other data typed by people stay as they are.

export type Lang = 'ar' | 'en'

function readLang(): Lang {
  try {
    return localStorage.getItem('lang') === 'en' ? 'en' : 'ar'
  } catch {
    return 'ar'
  }
}

export const lang: Lang = readLang()
export const isEn = lang === 'en'
/** Locale for dates and numbers. */
export const locale = isEn ? 'en-GB' : 'ar-EG'

export function setLang(next: Lang) {
  try {
    localStorage.setItem('lang', next)
  } catch {
    /* private mode: stays for this page only */
  }
  location.reload()
}

type Dict = { exact: Record<string, string>; patterns: [string, string][]; words: Record<string, string> }

const AR = /[؀-ۿ]/
const AR_DIGITS = /[٠-٩]/g
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function makeTranslator(dict: Dict) {
  // Most specific first: the pattern with the most fixed text wins.
  const fixed = (ar: string) => ar.replace(/\{\d+\}/g, '').length
  const patterns = [...dict.patterns].sort((a, b) => fixed(b[0]) - fixed(a[0])).map(([ar, en]) => {
    const order: number[] = []
    const re = ar
      .split(/(\{\d+\})/)
      .map((part) => {
        const m = /^\{(\d+)\}$/.exec(part)
        if (m) {
          order.push(Number(m[1]))
          return '(.*?)'
        }
        return escape(part)
      })
      .join('')
    return { re: new RegExp(`^${re}$`, 's'), order, en }
  })
  const wordRe = new RegExp(`(^|[^\\u0600-\\u06FF])(${Object.keys(dict.words).map(escape).join('|')})(?=$|[^\\u0600-\\u06FF])`, 'g')

  const core = (key: string): string | null => {
    const hit = dict.exact[key]
    if (hit !== undefined) return hit
    for (const p of patterns) {
      const m = p.re.exec(key)
      if (!m) continue
      const values: string[] = []
      p.order.forEach((n, i) => (values[n] = m[i + 1]))
      return p.en.replace(/\{(\d+)\}/g, (_, n) => {
        const v = values[Number(n)] ?? ''
        return core(norm(v)) ?? v
      })
    }
    // A number before or after a known text: «12 مشاركة», «جداد 5»
    const num = /^([\d٠-٩.,%+]+) (.+)$/.exec(key) ?? /^(.+) ([\d٠-٩.,%+]+)$/.exec(key)
    if (num) {
      const [, a, b] = num
      const isNumA = /^[\d٠-٩.,%+]+$/.test(a)
      const rest = core(isNumA ? b : a)
      if (rest !== null) return isNumA ? `${a} ${rest}` : `${rest} ${b}`
    }
    const swapped = key.replace(wordRe, (_, pre, w) => pre + dict.words[w])
    return swapped !== key ? swapped : null
  }

  /** English for an Arabic text, keeping its surrounding spaces; null when there is nothing to change. */
  return function translate(text: string): string | null {
    if (!AR.test(text) && !AR_DIGITS.test(text)) return null
    AR_DIGITS.lastIndex = 0
    const key = norm(text)
    let out = AR.test(key) ? core(key) : key
    if (out === null) return null
    out = out.replace(AR_DIGITS, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    if (out === key) return null
    const lead = /^\s*/.exec(text)![0]
    const trail = /\s*$/.exec(text)![0]
    return (lead ? ' ' : '') + out + (trail ? ' ' : '')
  }
}

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt']
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE'])

/** Switch the page to English and keep translating whatever React renders. */
export async function startEnglish() {
  const html = document.documentElement
  html.lang = 'en'
  html.dir = 'ltr'
  const dict = (await import('@/i18n/en.json')).default as unknown as Dict
  const translate = makeTranslator(dict)

  const skip = (el: Element | null) => !!el && (SKIP.has(el.tagName) || !!el.closest('[data-no-translate]'))
  const doText = (n: Text) => {
    if (skip(n.parentElement)) return
    const t = translate(n.nodeValue ?? '')
    if (t !== null && t !== n.nodeValue) n.nodeValue = t
  }
  const doAttrs = (el: Element) => {
    if (skip(el)) return
    for (const a of ATTRS) {
      const v = el.getAttribute(a)
      if (!v) continue
      const t = translate(v)
      if (t !== null && t !== v) el.setAttribute(a, t.trim())
    }
  }
  const walk = (root: Node) => {
    if (root.nodeType === Node.TEXT_NODE) return doText(root as Text)
    if (root.nodeType !== Node.ELEMENT_NODE) return
    doAttrs(root as Element)
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
    for (let n = it.nextNode(); n; n = it.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) doText(n as Text)
      else doAttrs(n as Element)
    }
  }

  walk(document.body)
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') doText(r.target as Text)
      else if (r.type === 'attributes') doAttrs(r.target as Element)
      else r.addedNodes.forEach(walk)
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS })

  const title = () => {
    const t = translate(document.title)
    if (t) document.title = t.trim()
  }
  title()
  new MutationObserver(title).observe(document.querySelector('title')!, { childList: true })

  const confirm0 = window.confirm.bind(window)
  window.confirm = (m?: string) => confirm0(m ? (translate(m) ?? m).trim() : m)
  const alert0 = window.alert.bind(window)
  window.alert = (m?: string) => alert0(m ? (translate(m) ?? m).trim() : m)
}
