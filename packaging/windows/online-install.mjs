import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';

// Experiment builds install the plugin-session-patch branch until it merges to main.
const INSTALL_REF = process.env.DSH_TAVERN_INSTALL_REF || 'experiment/plugin-session-patch';
const ADAPTED_DSH = '0.1.5-rc.2';
const ADAPTED_DESKTOP = '2.0.13';

const resources=path.dirname(fileURLToPath(import.meta.url));
const runtime=path.dirname(resources);
const data=path.resolve(process.argv[2]);
const home=path.join(data,'harness');
const source=path.join(home,'apps','dsh-tavern');
const pending=path.join(source,'.portable-install-pending.json');
const ready=path.join(source,'.portable-install-ready.json');
const log=path.join(data,'first-install.log');
fs.mkdirSync(data,{recursive:true});
const status=text=>process.stdout.write('DSH_STATUS '+text+'\n');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const exists=p=>fs.existsSync(p);
const hostRoot=exists(path.join(resources,'app','package.json'))
  ? path.join(resources,'app')
  : path.join(resources,'app.asar.unpacked');
const hostAnchor=path.join(hostRoot,'package.json');
const hostLib=path.join(hostRoot,'lib');
const hostModules=path.join(hostRoot,'node_modules');

async function request(url) {
  if(process.env.DSH_ONLINE_TEST_OFFLINE==='1')throw new Error('测试：网络不可用');
  let last;
  for(let attempt=0;attempt<3;attempt++) {
    try {const r=await fetch(url,{headers:{'User-Agent':'DSH-Tavern-Windows-Setup','Cache-Control':'no-cache'},signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('HTTP '+r.status);return Buffer.from(await r.arrayBuffer());}
    catch(e){last=e;if(attempt<2)await new Promise(r=>setTimeout(r,1000*(attempt+1)));}
  }
  throw Error('无法下载最新安装文件，请检查网络后重试。'+last.message);
}
// raw.githubusercontent.com is often blocked alone. After one network failure,
// later files try jsDelivr first instead of paying the retries again.
const fileHosts=[revision=>`https://raw.githubusercontent.com/flizzywine/dsh-tavern/${revision}/`,revision=>`https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@${revision}/`];
async function fromHosts(revision,file,check=()=>{}) {
  let last;
  for(const host of [...fileHosts]) {
    let bytes;
    try {bytes=await request(host(revision)+file.split('/').map(encodeURIComponent).join('/'));}
    catch(e){last=e;if(fileHosts[0]===host)fileHosts.push(fileHosts.shift());continue;}
    try {check(bytes);return bytes;}catch(e){last=e;}
  }
  throw last;
}
const downloadFile=(revision,item)=>fromHosts(revision,item.path,bytes=>{if(bytes.length!==item.size||digest(bytes)!==item.sha256)throw Error('文件校验不符：'+item.path);});
function run(args,cwd) {
  return new Promise((resolve,reject)=>{
    const stream=fs.createWriteStream(log,{flags:'a'});
    const child=spawn(process.execPath,args,{cwd,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});
    child.stdout.pipe(stream,{end:false});child.stderr.pipe(stream,{end:false});
    child.on('error',e=>{stream.end();reject(e);});child.on('close',code=>{stream.end();code===0?resolve():reject(Error('依赖安装或配置验证失败，可重新打开 EXE 重试。详细记录：'+log));});
  });
}
async function install() {
  // Existing installations are authoritative, including versions newer than this launcher.
  if(exists(path.join(source,'package.json'))&&!exists(pending)) {status('已找到本地酒馆，直接使用现有版本');return;}
  let metadata;
  if(exists(pending)) {
    metadata=JSON.parse(fs.readFileSync(pending,'utf8'));
    status('继续上次未完成的安装…');
  } else {
    status('正在查询最新版酒馆…');
    // GitHub API names the newest commit; jsDelivr's cached branch manifest is the fallback.
    let ref=INSTALL_REF;
    try {
      const head=JSON.parse(await request(`https://api.github.com/repos/flizzywine/dsh-tavern/commits/${encodeURIComponent(INSTALL_REF)}`));
      if(!/^[a-f0-9]{40}$/.test(head.sha))throw Error('GitHub 返回的版本信息无效');
      ref=head.sha;
    } catch(e){status('GitHub 暂不可达，改用 jsDelivr 查询最新版…');}
    metadata=JSON.parse(await fromHosts(ref,'dsh-tavern-runtime.json'));
    if(metadata.schemaVersion!==2||!/^[a-f0-9]{40}$/.test(metadata.revision)||!Array.isArray(metadata.files))throw Error('暂不支持最新安装清单格式，请更新启动器');
    for(const item of metadata.files) {
      if(typeof item.path!=='string'||item.path.includes('\\')||item.path.split('/').some(p=>!p||p==='.'||p==='..')||item.path.includes(':')||!/^[a-f0-9]{64}$/.test(item.sha256)||!Number.isSafeInteger(item.size)||item.size<0)throw Error('安装清单包含无效文件');
    }
    const compatibility=metadata.files.find(f=>f.path==='config/dsh-compatibility.json');
    if(!compatibility)throw Error('安装清单缺少兼容性信息');
    const config=JSON.parse(await downloadFile(metadata.revision,compatibility));
    if(config.adaptedDshVersion!==ADAPTED_DSH||config.recommendedDesktopVersion!==ADAPTED_DESKTOP)throw Error('最新版酒馆要求不同的 Desktop 版本，请等待此启动器适配；现有版本和数据未被覆盖。');
    const staging=path.join(home,'apps','download-'+randomUUID());fs.mkdirSync(staging,{recursive:true});
    let next=0,done=0;
    await Promise.all(Array.from({length:8},async()=>{
      while(next<metadata.files.length) {
        const item=metadata.files[next++];const bytes=await downloadFile(metadata.revision,item);const dest=path.join(staging,...item.path.split('/'));
        fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);done++;
        if(done%15===0||done===metadata.files.length)status(`正在下载 Tavern ${metadata.version}：${done}/${metadata.files.length}`);
      }
    }));
    fs.writeFileSync(path.join(staging,'.portable-install-pending.json'),JSON.stringify(metadata));
    fs.writeFileSync(path.join(staging,'.dsh-tavern-release.json'),JSON.stringify({commit:metadata.revision,installedAt:new Date().toISOString()}));
    if(exists(source))throw Error('安装目录已存在，请保留现有数据并检查目录后重试');
    fs.renameSync(staging,source);
  }
  if(process.env.DSH_ONLINE_TEST_FAIL_AFTER_DOWNLOAD==='1')throw Error('测试：下载后中断，保留待安装状态');
  Object.assign(process.env,{DSH_HOME:home,DSH_TAVERN_RUNTIME_HOST:'desktop',DSH_TAVERN_HOST:'desktop',DSH_TAVERN_APP_DIR:source,DSH_TAVERN_HOST_DEPENDENCY_ANCHOR:hostAnchor,DSH_DESKTOP_APP_EXECUTABLE:process.execPath,DSH_DESKTOP_DSH_BOOTSTRAP:path.join(hostLib,'desktop-cli.js'),CI:'true',npm_config_store_dir:path.join(data,'cache','pnpm'),npm_config_cache:path.join(data,'cache','npm'),npm_config_update_notifier:'false'});
  const {installDesktopPnpmRuntime,installDesktopDshRuntime}=await import(pathToFileURL(path.join(hostLib,'desktop-runtime-environment.js')));
  const pnpm=installDesktopPnpmRuntime({platform:process.platform,appExecutable:process.execPath,pnpmBinPath:path.join(hostModules,'pnpm','bin','pnpm.mjs'),electronVersion:process.versions.electron,stateDir:path.join(data,'desktop','runtime-commands'),environment:process.env});
  installDesktopDshRuntime({platform:process.platform,appExecutable:process.execPath,dshBootstrapPath:path.join(hostLib,'desktop-cli.js'),profileName:'tavern',homeDir:home,stateDir:path.join(data,'desktop','host-commands','tavern'),environment:process.env});
  process.env.PATH=pnpm.nodeBinDir+path.delimiter+process.env.PATH;
  status(`正在安装 Tavern ${metadata.version} 的依赖，首次需要联网…`);
  await run([path.join(hostModules,'pnpm','bin','pnpm.cjs'),'--config.minimumReleaseAge=0','install','--frozen-lockfile','--store-dir',path.join(data,'cache','pnpm')],source);
  status('正在配置酒馆并检查 Desktop 兼容性…');
  await run([path.join(source,'bin','dsh-tavern.mjs'),'install','--host','desktop'],source);
  fs.writeFileSync(ready,JSON.stringify({version:metadata.version,commit:metadata.revision,installedAt:new Date().toISOString()}));
  fs.unlinkSync(pending);
  status(`Tavern ${metadata.version} 安装完成`);
}
install().catch(e=>{fs.appendFileSync(log,String(e.stack||e)+'\n');process.stderr.write(e.message+'\n');process.exitCode=1;});
