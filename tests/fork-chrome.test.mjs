// private fork: follow upstream module extraction without weakening behavior assertions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
// private fork: shell declarations moved into the independent UI package.
const css=['../tavern-plugin/lib/client-assets/fork-theme.css','../tavern-plugin/packages/dsh-tavern-ui/src/shell.css'].map(file=>fs.readFileSync(new URL(file,import.meta.url),'utf8')).join('\n');
const client=fs.readFileSync(new URL('../tavern-plugin/lib/client.js',import.meta.url),'utf8');
test('player messages use reading size and dialogue avatars are larger',()=>{
 assert.match(css,/\.dsh-tavern-user-bubble,[\s\S]*?font-size: var\(--dsh-content-font-size, var\(--fork-reading-size\)\) !important/);
 assert.match(css,/width: 4\.2em; height: 4\.2em/);
});
test('fork hides host and card scrollbars without disabling overflow',()=>{
 assert.match(css,/body\.dsh-tavern-shell-active \* \{ scrollbar-width: none !important/);
 assert.equal(client.split('scrollbar-width:none!important;scrollbar-gutter:auto!important').length-1,2);
});
test('model menu uses an opaque canvas backing for translucent skins',()=>{
 assert.match(css,/\[role="menu"\]\[aria-label="模型与推理等级"\][\s\S]*?background: linear-gradient\([^\n]+Canvas !important/);
});
test('thinking status takes its shimmer colors from the active skin without overriding animation',()=>{
 const rule=css.match(/body\.dsh-tavern-shell-active \[role="status"\]\[class\*="_turnStatus"\] \{([^}]+)\}/)?.[1];
 assert.ok(rule);
 assert.match(rule,/--dsw-static-deepseek-500: var\(--dsw-alias-brand-primary\)/);
 assert.match(rule,/--dsw-static-deepseek-200: color-mix\(in srgb, var\(--dsw-alias-brand-primary\) 28%, white\)/);
 assert.doesNotMatch(rule,/animation|font-size|text-fill-color/);
});
test('reply header is the single bold card title and toolbar has no gaps',()=>{
 // Private fork: remove the redundant header itself, not only its title.
 const status=fs.readFileSync(new URL('../tavern-plugin/src/client/fork-status-panel.js',import.meta.url),'utf8');
 assert.doesNotMatch(status,/className: "fork-status-head"|已结算/);
 assert.match(status,/fork-status-tab-spinner/);
 assert.match(status,/p\.retrySettlement/);
 assert.match(css,/\[class\*="_crumbCurrent"\] \{ font-weight: 700/);
 assert.match(css,/\.dsh-tavern-dock-actions\.dsh-fork-inline-actions \{ gap: 0; margin: 0; \}/);
});
