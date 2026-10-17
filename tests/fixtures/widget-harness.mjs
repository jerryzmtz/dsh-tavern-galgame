// private fork: pack-only cards do not persist empty retired character tables.
// private fork: browser security fixtures use real v2 packs and P4 authorized widget leases.
import path from 'node:path'
import {tmpdir} from 'node:os'
import {mkdtemp, rm, readFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {createAssetPackService} from '../../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {createAssetPackPresentation} from '../../tavern-plugin/lib/domain/asset-pack-presentation.js'
import {defaultAssetEngineSettings} from '../../tavern-plugin/lib/domain/asset-engine-settings.js'
export const templateRoot = new URL('./widgets/letter/', import.meta.url)
export async function templateFiles() { return Promise.all(['widget.json', 'index.html', 'index.js', 'style.css'].map(async file => ({path:file, content:await readFile(new URL(file,templateRoot),'utf8')}))) }
export async function widgetFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(),'fork-widget-test-'))
  const service = createAssetPackService({assetRoot:path.join(root,'assets'),authorizeLease:async () => true})
  let snapshot = (await service.createPack({name:'Widget fixture',expectedRevision:null})).snapshot
  const ref = {packId:snapshot.manifest.id,kind:'widgets',assetId:'letter-card'}
  let engine = defaultAssetEngineSettings(), consumer, origin, generation = 0, widgetsEnabled = false
  // private fork: execution/revocation belongs to the card, not a machine-wide widget dimension.
  const card = () => ({extensions:{dsh_tavern:{schemaVersion:1,stage:{widgets:widgetsEnabled},assetBindings:{boundPackIds:[ref.packId]}}}})
  async function publish(files) {
    const manifest = JSON.parse(files.find(file => file.path === 'widget.json').content)
    const asset = {kind:'widgets',id:ref.assetId,name:'Letter',enabled:true,recall:{mode:'constant',keywords:[]},directorNote:'A short letter',
      bundleKey:'letter',entry:'widget.json'}
    snapshot = (await service.patchPack({packId:ref.packId,expectedRevision:snapshot.revision,
      patch:{assets:[asset],bundles:{letter:{kind:'widget',entry:'widget.json',contentHash:'0'.repeat(64)}}},
      fileUpdates:new Map(files.map(file => ['bundles/letter/'+file.path,Buffer.from(file.content)]))})).snapshot
    generation++
  }
  async function enable() { widgetsEnabled=true;generation++;consumer?.rebind(card()) }
  function disable() { widgetsEnabled=false;generation++;consumer?.rebind(card()) }
  async function widgets(props = {body:'Hello'}) {
    const epoch = generation
    return consumer.widgets({widgets:{letter:{ref,state:props,slot:'center-card',lifetime:{until:'explicit'},bornStoryTime:0}}},{engine,isCurrent:() => epoch === generation})
  }
  function connect(value) {
    origin = value
    consumer = createAssetPackPresentation({raw:card(),getService:() => service,origin,scope:'dsh-browser'})
  }
  async function serve(req,res) {
    const url = new URL(req.url,origin), match = /^\/api\/dsh-asset-library\/v2\/lease\/([^/]+)\/(.+)$/.exec(url.pathname)
    if (!match) return false
    const response = await service.respondLease({ticket:match[1],resource:decodeURIComponent(match[2]),request:new Request(url,{method:req.method,headers:req.headers})})
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return true
  }
  t.after(async () => { consumer?.dispose();await service.dispose();await rm(root,{recursive:true,force:true}) })
  return {root,service,publish,enable,disable,widgets,connect,serve,ref}
}
export async function widgetServer(t, fixture, extra) {
  const server = createServer(async (req,res) => {
    try {if (await fixture.serve(req,res)) return;if(extra && await extra(req,res))return;res.writeHead(404);res.end()}
    catch(error){res.writeHead(403);res.end(error.code || error.message)}
  })
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
  t.after(() => new Promise(resolve => {server.closeAllConnections();server.close(resolve)}))
  const origin = 'http://127.0.0.1:'+server.address().port;fixture.connect(origin);return origin
}
