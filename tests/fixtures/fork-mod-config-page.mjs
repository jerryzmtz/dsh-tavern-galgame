// private fork (mod settings UI): the real client pieces for an offline page — React, the shared colour helper, ForkSpinner,
// ForkInlineField, the data picker / formula box and the settings editor sources, plus the in-page RPC fake — and the real
// client stylesheets (host shell tokens, fork theme, runtime surfaces, fork-mod-config.css). Used by
// tests/fork-mod-config-ui-browser.test.mjs and the dev gallery output/mod-plan/config-ui (build.mjs).
import { readFile } from 'node:fs/promises'
import { browserReactScript } from './browser-react.mjs'
import { forkThemeCss } from '../helpers/fork-theme-css.mjs'

const root = new URL('../../', import.meta.url)
const text = path => readFile(new URL(path, root), 'utf8')

export async function modConfigScript() {
  const client = name => text('tavern-plugin/src/client/' + name)
  return [
    await browserReactScript(),
    'const React=modules.react,ReactDOM=modules["react-dom"];',
    '(()=>{' + await text('tavern-plugin/shared/figure-auto-color.cjs') + ';window.figureColorShades=figureColorShades;})();',
    await client('fork-spinner.js'), await client('fork-inline-field.js'), await client('fork-data-picker.js'), await client('fork-mod-config-ui.js'),
    'Object.assign(window,{ForkScopeSwitch,ForkOverrideDot,ForkValueEditor,ForkDataPicker,ForkFormulaInput,ForkPreviewHotspots,useForkModConfig,ForkSegmented,ForkInlineField});',
    await text('tests/fixtures/fork-mod-config-fake.js')
  ].join('\n;\n')
}

export async function modConfigCss() {
  return await forkThemeCss() + '\n' + await text('tavern-plugin/lib/client-assets/fork-mod-config.css')
}

// Host palette on <body> (DeepSeek-like light / dark), as the host provides --dsw-* in production.
export const HOST = {
  light: '--dsw-alias-bg-base:#ffffff;--dsw-alias-label-primary:#0f1115;--dsw-alias-label-secondary:#4c525c;--dsw-alias-label-tertiary:#7a808b;--dsw-alias-border-l2:#e6e8ec;--dsw-alias-border-l3:#d3d6dc;--dsw-alias-interactive-bg-hover:#f1f2f4;--dsw-specific-sidebar-fill:#f7f8fa;--dsw-specific-input-major:#f4f5f7;--dsw-alias-brand-primary:#4d6bfe;--dsw-alias-bg-layer-1:#ffffff;',
  dark: '--dsw-alias-bg-base:#1c1d20;--dsw-alias-label-primary:#f2f3f5;--dsw-alias-label-secondary:#c3c7cf;--dsw-alias-label-tertiary:#9298a3;--dsw-alias-border-l2:#34363b;--dsw-alias-border-l3:#44474d;--dsw-alias-interactive-bg-hover:#2a2c30;--dsw-specific-sidebar-fill:#232427;--dsw-specific-input-major:#26282c;--dsw-alias-brand-primary:#6b8afd;--dsw-alias-bg-layer-1:#1c1d20;'
}
