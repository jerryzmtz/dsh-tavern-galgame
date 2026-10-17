import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {projectReplyHistory} from '../tavern-plugin/lib/domain/reply-presentation.js'
test('plain template projections leave the DOM runtime unloaded until HTML parsing is needed', () => {
 const variableUrl = new URL('../tavern-plugin/lib/domain/template-variable-display.js', import.meta.url).href
 const repairUrl = new URL('../tavern-plugin/lib/domain/legacy-template-display-repair.js', import.meta.url).href
 const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
  import assert from 'node:assert/strict';
  import {createRequire} from 'node:module';
  import {visibleTemplateDisplay, annotateTemplateStatusParts} from ${JSON.stringify(variableUrl)};
  import {repairLegacyTemplateDisplay} from ${JSON.stringify(repairUrl)};
  const require = createRequire(${JSON.stringify(variableUrl)});
  const loaded = () => Object.keys(require.cache).some(path => path.replaceAll('\\\\', '/').includes('/jsdom/'));
  assert.equal(loaded(), false);
  const plain = {html:'<p>plain</p>'};
  assert.deepEqual(visibleTemplateDisplay(plain), plain);
  assert.deepEqual(annotateTemplateStatusParts([], plain.html), []);
  assert.equal(repairLegacyTemplateDisplay(plain, {}), plain);
  assert.equal(loaded(), false);
  assert.equal(visibleTemplateDisplay({html:'<p>plain</p><initvar>secret</initvar>'}).html, plain.html);
  assert.equal(loaded(), true);
 `], {encoding:'utf8', timeout:20000, windowsHide:true})
 assert.ifError(result.error)
 assert.equal(result.status, 0, result.stderr + result.stdout)
})

function project(html,parts){const source='正文\n<initvar>{"secret":"INITIAL_VALUE"}</initvar>';const display={source,swipe:0,html,...(parts?{parts}:{})};const message={role:'assistant',turn:1,text:source,sourceText:source,tavernPluginData:{template_display:display}};const before=structuredClone(message);const result=projectReplyHistory([message]);assert.deepEqual(message,before);return result.projections[0]}

test('模板分块隐藏初始化和更新协议，保留面板身份和代码示例',()=>{
 const prose='<p>正文</p><INITVAR>INITIAL_VALUE</INITVAR><UpdateVariable>PATCH_VALUE</UpdateVariable>'
 const panel='<div>面板</div><script>const example="<initvar>keep</initvar>";</script>'
 const example='<pre><code><initvar>example</initvar></code></pre>'
 const result=project(prose+panel+example,[{kind:'html',content:prose},{kind:'html',content:panel,statusKey:'panel-1'},{kind:'html',content:example}])
 assert.equal(result.parts[0].content,'<p>正文</p>');assert.equal(result.parts[1].content,panel);assert.equal(result.parts[1].statusKey,'panel-1');assert.equal(result.parts[2].content,example)
 assert.doesNotMatch(result.text,/INITIAL_VALUE|PATCH_VALUE/)
})
