'use strict';
// private fork: first-party phone mod (iPhone 15 Pro Max look). The host owns hidden/compact/open, attention counts,
// history and timing; this page only paints the accepted, already revealed text it receives.
(() => {
    let token=null,presentation={state:'hidden',suspended:true,attention:{count:0,changed:false}},source=null,settings={},settingAssets={},theme={},playback={},lastEvent=null,hydrated=false,lastCurrent=null;
    const send=(type,data={})=>parent.postMessage({channel:'dsh-widget',version:2,token,type,...data},'*');
    const $=id=>document.getElementById(id),body=document.body,root=document.documentElement.style;
    const phone=$('phone'),messages=$('messages'),island=$('island'),reducedQuery=matchMedia('(prefers-reduced-motion: reduce)');
    const STICKER=/^(?:\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*\s*){1,3}$/u;
    const ink=hex=>{const rgb=hex.slice(1).match(/../g).map(value=>parseInt(value,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]>.179?'#000000':'#ffffff';};
    const reduced=()=>presentation.reducedMotion===true || reducedQuery.matches;
    const live=()=>playback.mode==='live' && !playback.skipping && !presentation.suspended;
    function appearance(transitionMs=0) {
        // Nine stage tokens arrive already contrast-checked; custom colours only override the matching token.
        const tokens={accent:'--gal-ui-accent',accentText:'--gal-ui-accent-ink',surface:'--gal-ui-surface',surfaceText:'--gal-ui-ink',muted:'--gal-ui-ink-2',border:'--gal-ui-line',fontFamily:'--gal-ui-font',headingFont:'--gal-ui-title-font'};
        root.setProperty('--theme-transition',(reduced()?0:transitionMs)+'ms');
        for(const [key,property] of Object.entries(tokens))if(theme[key]!==undefined)root.setProperty(property,theme[key]);
        if(Number.isFinite(theme.radius))root.setProperty('--gal-ui-radius',theme.radius+'px');
        for(const [key,property] of [['accentColor','--gal-ui-accent'],['surfaceColor','--gal-ui-surface'],['bodyColor','--phone-body']]) {
            const value=settings[key];
            if(/^#[0-9a-f]{6}$/.test(value)) {root.setProperty(property,value);if(key!=='bodyColor')root.setProperty(key==='accentColor'?'--gal-ui-accent-ink':'--gal-ui-ink',ink(value));if(key==='surfaceColor')root.setProperty('--gal-ui-ink-2',ink(value));}
            else if(key==='bodyColor')root.setProperty(property,theme.border || '#3b3a38');
        }
        const clock=settings.clockText ?? '09:41';
        if($('clock').textContent!==clock)$('clock').textContent=clock;
        $('status-bar').hidden=settings.statusBar===false;
        const level=Math.max(0,Math.min(100,Number(settings.battery ?? 80) || 0)),battery=$('battery');
        battery.querySelector('.pct').firstChild.nodeValue=String(level);battery.dataset.level=forkPhoneBatteryLevel(level);battery.style.setProperty('--level',level/100);
        // Carrier text and signal bars (0–4) are settings of the mod page (全局 / 本卡).
        const carrier=typeof settings.carrier==='string' ? settings.carrier : '';
        if($('carrier').textContent!==carrier)$('carrier').textContent=carrier;
        const bars=Math.max(0,Math.min(4,Math.round(Number(settings.signal ?? 4) || 0)));
        document.querySelectorAll('.signal rect').forEach((rect,i)=>rect.classList.toggle('off',i>=bars));
        const cutout=['island','notch','none'].includes(settings.cutout) ? settings.cutout : 'island';
        $('cutout').dataset.kind=cutout;body.dataset.cutout=cutout;
        // Unavailable choices use the built-in plain surface without clearing the persistent selection.
        const wallpaper=settingAssets.wallpaper;
        phone.style.backgroundImage=wallpaper?.url ? `url(${JSON.stringify(wallpaper.url)})` : '';
        body.dataset.wallpaper=wallpaper?.url ? 'image' : 'stage';
    }
    // Per-character 备注名 / 头像 from the mod settings, keyed by the stage alias; the card's own name and face otherwise.
    const contactName=alias=>{const name=settings.contacts?.[alias]?.name;return typeof name==='string' && name ? name : '';};
    const contactAvatar=alias=>settingAssets['contact:'+alias]?.url || null;
    function setImage(node,url) {
        if(url){if(node.getAttribute('src')!==url)node.src=url;node.hidden=false;}
        else {node.removeAttribute('src');node.hidden=true;}
    }
    const voiceSeconds=text=>Math.max(1,Math.ceil(Array.from(text || '').length/4));
    // private fork (owner 2026-10): the host sizes the phone (and the banner, as wide as its screen) with the stage; the
    // view keeps the 280-wide design and zooms to that size. The reading sheet stays at 1:1.
    function fit() {
        const base=presentation.state==='compact' ? 265 : 280,sheet=presentation.surface==='sheet';
        const zoom=sheet || !innerWidth ? 1 : Math.min(1.6,Math.max(.7,innerWidth/base));
        const value=String(Math.round(zoom*1000)/1000);
        if(document.documentElement.style.zoom!==value)document.documentElement.style.zoom=value;
    }
    window.addEventListener('resize',fit);
    function makeRow(message) {
        const row=document.createElement('article'),image=document.createElement('img'),bubble=document.createElement('div'),text=document.createElement('p'),play=document.createElement('button'),dots=document.createElement('span'),note=document.createElement('small');
        row.dataset.messageId=message.id;image.alt='';image.width=image.height=28;image.decoding='async';
        bubble.className='bubble';dots.className='dots';dots.setAttribute('aria-hidden','true');dots.append(document.createElement('i'),document.createElement('i'),document.createElement('i'));
        play.type='button';play.className='voice';play.setAttribute('aria-label','\u91cd\u64ad\u8bed\u97f3');play.title='\u91cd\u64ad\u8bed\u97f3';
        play.innerHTML='<svg viewBox="0 0 9 10" aria-hidden="true"><path d="M0 0v10l9-5z"/></svg><i></i><i></i><i></i><i></i><i></i>';
        play.onclick=()=>send('voice.replay',{handle:row.dataset.voice});
        note.className='note';note.textContent='\u26a0 \u5168\u6587\u89c1\u5c65\u5386';
        const transcript=document.createElement('button'),duration=document.createElement('span');
        transcript.type='button';transcript.className='transcript-toggle';transcript.textContent='文字';
        transcript.onclick=()=>send('transcript.toggle',{id:row.dataset.messageId});
        duration.className='duration';
        bubble.append(text,play,dots,duration,transcript);row.append(image,bubble,note);
        row.addEventListener('animationend',()=>row.classList.remove('enter','sent'));
        return row;
    }
    function render() {
        const state=presentation.state,lines=source?.messages || [],last=lines.at(-1),contact=last?.contact;
        body.dataset.presentation=state;body.dataset.surface=presentation.surface==='sheet'?'sheet':'stage';body.dataset.motion=reduced()?'reduced':'full';fit();
        const current=source?.current ? lines.find(row=>row.id===source.current.id) : null;
        const pending=Boolean(current && live() && source.current.revealed===false);
        const typingIn=pending && current.side==='in',composing=pending && current.side==='out' && state==='open';
        const name=contactName(contact) || lines.find(row=>row.alias===contact)?.name || contact || '';
        const peer=lines.findLast(row=>row.side==='in' && row.contact===contact && source?.avatars?.[row.avatar]);
        const avatar=contactAvatar(contact) || (peer ? source.avatars[peer.avatar] : null);
        if($('contact').textContent!==name)$('contact').textContent=name;
        setImage($('head-avatar'),avatar);
        const presence=typingIn ? '\u6b63\u5728\u8f93\u5165\u2026' : '';
        if($('presence').textContent!==presence)$('presence').textContent=presence;
        $('presence').classList.toggle('on',typingIn);
        renderThread(lines,current,typingIn,composing);
        // The outgoing line is typed into the composer while the host reveals it, then it is sent.
        const draft=composing ? current.text : '';
        if($('draft').textContent!==draft)$('draft').textContent=draft;
        $('field').classList.toggle('typing',composing);$('send').classList.toggle('ready',composing && Boolean(draft));
        renderIsland(last,name,avatar,typingIn,current);
        const status=$('history-status');
        const statusText=({loading:'',unavailable:'\u26a0 \u5386\u53f2\u8bb0\u5f55\u4e0d\u53ef\u7528\uff0c\u8bf7\u67e5\u770b\u5c65\u5386',limited:'\u26a0 \u4ec5\u663e\u793a\u6700\u8fd1\u8bb0\u5f55'})[source?.historyStatus] ?? '';
        status.dataset.kind=source?.historyStatus || 'ready';
        status.hidden=state!=='open' || !(statusText || source?.historyStatus==='loading');
        if(status.textContent!==statusText)status.textContent=statusText;
        lastCurrent=current?.id || null;hydrated=true;
    }
    let threadTask=null;
    function renderThread(lines,current,typingIn,composing) {
        const top=messages.scrollTop,atBottom=messages.scrollHeight-messages.clientHeight-top<24;
        const anchor=atBottom?null:[...messages.children].find(row=>row.getBoundingClientRect().bottom>messages.getBoundingClientRect().top),anchorTop=anchor?.getBoundingClientRect().top;
        const visible=composing ? lines.filter(row=>row.id!==current.id) : lines;
        const existing=new Map([...messages.children].map(row=>[row.dataset.messageId,row])),keep=new Set(visible.map(message=>message.id));
        for(const [id,row] of existing)if(!keep.has(id))row.remove();
        let index=0,created=0;
        for(const [i,message] of visible.entries()) {
            let row=existing.get(message.id);
            if(!row){
                // Bound initial history construction even when the iframe shares the stage thread.
                if(created===8){if(threadTask===null)threadTask=setTimeout(()=>{threadTask=null;render();},0);break;}
                created++;row=makeRow(message);
                // Only a fresh, live line animates in; history, skip and restores appear at once.
                if(hydrated && live() && message.id===current?.id && message.id!==lastCurrent)row.classList.add(message.side==='out'?'sent':'enter');
                else if(hydrated && live() && message.side==='out' && message.id===current?.id)row.classList.add('sent');
            }
            const [image,bubble,note]=row.children,[text,play,dots,duration,transcript]=bubble.children,previous=visible[i-1],next=visible[i+1];
            row.dataset.side=message.side;row.dataset.voice=message.voice || '';
            const nextSide=next ? next.side : typingIn && message.id!==current?.id ? 'in' : null;
            row.classList.toggle('start',!previous || previous.side!==message.side || previous.turn!==message.turn);
            row.classList.toggle('end',nextSide!==message.side || next && next.turn!==message.turn);
            row.classList.toggle('turn-start',Boolean(previous && previous.turn!==message.turn));
            const avatar=message.side==='in' && row.classList.contains('end') ? contactAvatar(message.contact) || source?.avatars?.[message.avatar] : null;
            setImage(image,avatar);
            if(text.textContent!==message.text)text.textContent=message.text;
            bubble.classList.toggle('sticker',STICKER.test(message.text.trim()) && message.revealed!==false);
            dots.hidden=!(typingIn && message.id===current?.id);
            const voice=message.form==='voice';
            row.dataset.form=voice?'voice':'text';
            // Mod rows always have a form; generic source-widget rows retain their optional replay handle.
            play.hidden=message.form ? !voice : !message.voice;play.disabled=!message.voice;
            duration.hidden=transcript.hidden=!voice;
            if(voice){const label='约 '+voiceSeconds(message.text)+' 秒';if(duration.textContent!==label)duration.textContent=label;}
            transcript.setAttribute('aria-expanded',String(Boolean(message.transcript)));
            text.classList.toggle('transcript',voice);text.classList.toggle('is-expanded',Boolean(message.transcript));
            text.setAttribute('aria-hidden',String(voice && !message.transcript));
            note.hidden=!message.truncated;
            // Preserve focused controls, text selection and scroll while an unrelated message reveals.
            if(messages.children[index]!==row)messages.insertBefore(row,messages.children[index] || null);
            index++;
        }
        messages.scrollTop=atBottom?messages.scrollHeight:top+(anchor?.isConnected?anchor.getBoundingClientRect().top-anchorTop:0);
    }
    // private fork (owner 2026-10): a real phone's notification banner — app row (icon · 信息 · 现在), the sender in bold, a
    // one-line preview (a voice message reads 「[语音] 4″」) and the sender's small avatar on the right.
    function renderIsland(last,name,avatar,typingIn,current) {
        const shown=current?.side==='in' ? current : null,attention=presentation.attention || {count:0,changed:false};
        island.hidden=!shown;
        const senderAvatar=shown ? contactAvatar(shown.contact) || source?.avatars?.[shown.avatar] : null;
        setImage($('island-avatar'),senderAvatar);island.classList.toggle('has-avatar',Boolean(senderAvatar));
        const title=shown ? contactName(shown.contact) || shown.name || '\u6d88\u606f' : '';
        if($('island-name').textContent!==title)$('island-name').textContent=title;
        const preview=shown?.form==='voice' ? '[语音] '+voiceSeconds(shown.text)+'″' : !shown ? '' : typingIn && !shown.text ? '\u6b63\u5728\u8f93\u5165\u2026' : shown.text.replace(/\s+/g,' ');
        const box=$('island-preview');
        if(box.textContent!==preview)box.textContent=preview;
        const count=Number(attention.count) || 0;
        island.setAttribute('aria-label','\u6253\u5f00\u624b\u673a'+(name?'\uff1a'+name:'')+(count?'\uff0c'+(count>99?'99+':count)+' \u6761\u5f85\u67e5\u770b':attention.changed?'\uff0c\u6709\u66f4\u65b0':''));
    }
    const openFromIsland=()=>send('action',{action:'open'});
    island.onclick=openFromIsland;
    island.onkeydown=event=>{if(event.key==='Enter' || event.key===' '){event.preventDefault();openFromIsland();}};
    $('toggle').onclick=()=>send('action',{action:presentation.state==='open'?'collapse':'open'});
    document.addEventListener('click',event=>{if(!event.target.closest('button,a,input,textarea,[role="button"]'))send('stage.advance');});
    window.addEventListener('keydown',event=>{
        if(event.key==='Escape'){event.preventDefault();send('action',{action:'collapse'});}
        else if((event.key==='Enter' || event.key===' ') && !event.target.closest('button,a,input,textarea,[role="button"]')){event.preventDefault();send('stage.advance');}
    });
    let wheelAt=0;
    window.addEventListener('wheel',event=>{event.preventDefault();if(performance.now()-wheelAt<100)return;wheelAt=performance.now();send('stage.wheel',{deltaY:event.deltaY,deltaMode:event.deltaMode});},{passive:false});
    reducedQuery.addEventListener?.('change',()=>{appearance();render();});
    window.addEventListener('message',event=>{
        const value=event.data;
        if(event.source!==parent || !value || value.channel!=='dsh-widget' || value.version!==2 || typeof value.token!=='string')return;
        if(value.type==='init'){
            if(token)return;token=value.token;settings=value.settings || {};settingAssets=value.settingAssets || {};theme=value.theme || {};playback=value.playback || {};presentation=value.presentation || presentation;
            appearance();render();send('ready');return;
        }
        if(!token || value.token!==token)return;
        if(value.type==='presentation'){presentation=value.presentation || presentation;render();}
        else if(value.type==='update')render();
        else if(value.type==='settings'){settings=value.settings || {};settingAssets=value.settingAssets || {};appearance();if(source)render();}
        else if(value.type==='source'){
            const changed=source?.threadKey!==value.source?.threadKey;source=value.source;
            if(changed){messages.replaceChildren();hydrated=false;}
            const incoming=source?.messages.find(row=>row.id===source.current?.id)?.side==='in';
            if(playback.eventToken && playback.eventToken!==lastEvent){lastEvent=playback.eventToken;
                if(settings.sound!==false && incoming && playback.mode==='live' && playback.fresh && !playback.skipping && !playback.paused && !presentation.suspended)send('audio.play',{asset:'message',eventToken:playback.eventToken});
            }
            render();
            if(changed)messages.scrollTop=messages.scrollHeight;
        } else if(value.type==='playback'){playback=value.playback || {};render();}
        else if(value.type==='theme'){theme=value.theme || {};appearance(value.transitionMs || 0);}
        else if(value.type==='hide'){source=null;messages.replaceChildren();hydrated=false;lastCurrent=null;}
    });
})();
