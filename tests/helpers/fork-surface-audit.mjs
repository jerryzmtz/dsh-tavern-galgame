// private fork: conservative audit includes animation/icon opacity; exceptions must explain their use.
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../', import.meta.url)).replaceAll('\\', '/')
const roots = ['tavern-plugin/lib/client-assets/fork-theme.css', 'tavern-plugin/src/client', 'tavern-plugin/packages/dsh-tavern-ui/src', 'tavern-plugin/packages/dsh-tts/src', 'tavern-plugin/packages/dsh-tts-local/src']
function files(path) { if (/\.(css|[cm]?js|tsx?)$/.test(path)) return [path]; return readdirSync(root + path, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path + '/' + e.name) : /\.(css|[cm]?js|tsx?)$/.test(e.name) ? [path + '/' + e.name] : []); }
export function violations(source, path) {
  const found = []
  const add = (selector, declaration) => found.push({ path, selector: selector.trim().replace(/\s+/g, ' '), declaration: declaration.trim().replace(/\s+/g, ' ') })
  const unsafe = /backdrop-filter\s*:(?!\s*none\b)|\bopacity\s*:(?!\s*1\s*(?:[;} ,!]|$))|(?:background(?:-color)?|--[\w-]*(?:bg|surface|fill|veil)[\w-]*)\s*:[^;}\n]*(?:rgba\(|rgb\([^)]*\/|#[\da-f]{8}\b|#[\da-f]{4}\b|color-mix\([^;]*transparent)/i
  // Scan declarations with their nearest brace selector, including CSS embedded in template strings.
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].replace(/\/\*[\s\S]*?\*\//g, '').trim().split('\n').at(-1)
    for (const declaration of match[2].split(';')) if (unsafe.test(declaration)) add(selector, declaration)
  }
  // Object-style opacity / backgroundColor assignments do not have CSS selectors.
  // private fork: literal opacity:1 is opaque (also used as a paint-only property flag), not a translucent surface.
  const inline = /(?:\.style\.(?:opacity|backgroundColor)|\bopacity\s*:(?!\s*1\s*(?:[,}]|$))|\bbackgroundColor\s*:)/
  if (!path.endsWith('.css')) for (const line of source.split('\n')) if (inline.test(line) && /(?:opacity|rgba\(|#[\da-f]{8}\b)/i.test(line)) add('[inline style]', line)
  return found
}
export function audit() {
  return roots.flatMap(files).filter(p => !/\/fork-surfaces\.(?:cjs|js)$/.test(p)).flatMap(path => violations(readFileSync(root + path, 'utf8'), path))
}
