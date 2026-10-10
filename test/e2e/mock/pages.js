// Stand-in pages shaped like the parts of x.com the extension drives: the left nav, a primary column with a tab bar and a
// virtualised list (only posts near the scroll position exist, as on X), the right sidebar, the floating drawer, #layers.
'use strict';

const SCRIPTS = ['settings', 'logic', 'keys', 'parse', 'site', 'meta', 'sample', 'main'].map((n) => `<script src="/ext/src/${n}.js"></script>`).join('');

function shell(title, body, script) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<script src="/ext/src/hook.js"></script>
<script>window.__INITIAL_STATE__ = { featureSwitch: { defaultConfig: { rweb_age_assurance_flow_enabled: { value: true }, other_flag: { value: true } }, user: { config: {} } } };</script>
<link rel="stylesheet" href="/ext/src/styles.css"><style id="react-native-stylesheet">.r-blur{filter:blur(30px)}.r-other{filter:blur(2px)}</style><style>html,body{height:100%} body{overflow-y:scroll} #react-root{min-height:100%;display:flex;flex-direction:column}</style></head>
<body style="margin:0;background:#000;color:#e7e9ea;font-family:sans-serif">
<div id="react-root">
<header role="banner" style="position:fixed;left:200px;top:0;bottom:0;width:260px"><nav style="display:flex;flex-direction:column;align-items:flex-start"><h1 style="margin:0"><a href="/home"><svg viewBox="0 0 24 24" width="30" height="30"><g><path d="M14.258 10.152L23.176 0h-2.113l-7.747 8.813L7.133 0H0l9.352 13.328L0 23.973h2.113l8.176-9.309 6.531 9.309h7.133z"></path></g></svg></a></h1>
 <a href="/home" data-testid="AppTabBar_Home_Link"><div style="display:inline-flex;align-items:center;padding:12px"><div><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h16"/></svg></div><div dir="ltr" style="margin-left:20px"><span>Home</span></div></div></a><br><a href="/explore"><div style="display:inline-flex;align-items:center;padding:12px"><div><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h16"/></svg></div><div dir="ltr" style="margin-left:20px"><span>Explore</span></div></div></a><br><a href="/notifications"><div style="display:inline-flex;align-items:center;padding:12px"><div><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h16"/></svg></div><div dir="ltr" style="margin-left:20px"><span>Notifications</span></div></div></a><br><a href="/i/grok"><div style="display:inline-flex;align-items:center;padding:12px"><div><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h16"/></svg></div><div dir="ltr" style="margin-left:20px"><span>Grok</span></div></div></a><br><a href="/i/bookmarks"><div style="display:inline-flex;align-items:center;padding:12px"><div><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h16"/></svg></div><div dir="ltr" style="margin-left:20px"><span>History</span></div></div></a><br><a href="/i/jf/creators/studio"><div style="display:inline-flex;align-items:center;padding:12px"><div><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h16"/></svg></div><div dir="ltr" style="margin-left:20px"><span>Creator Studio</span></div></div></a>
 <a href="/user1" data-testid="AppTabBar_Profile_Link"><div style="display:inline-flex;align-items:center;padding:12px"><div><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h16"/></svg></div><div dir="ltr" style="margin-left:20px"><span>Profile</span></div></div></a>
 <a href="/compose/post" data-testid="SideNav_NewTweet_Button" style="display:block;width:230px;height:52px;border-radius:9999px;background:#eee;color:#000;text-align:center;line-height:52px;font-size:17px;font-weight:700"><span><span>Post</span></span></a></nav>
 <div data-testid="SideNav_AccountSwitcher_Button" style="position:absolute;bottom:10px;width:250px">account</div></header>
${body}
<div data-testid="sidebarColumn" style="position:fixed;right:200px;top:0;width:300px"><input data-testid="SearchBox_Search_Input" placeholder="Search"><br><a href="/explore">Trending</a><div aria-label="Who to follow">Who to follow</div></div>
<div id="drawer" style="position:fixed;right:16px;bottom:16px;width:60px;display:flex;flex-direction:column;gap:8px"><div><button aria-label="Grok" id="grokb" style="width:50px;height:50px">G</button></div><div><button aria-label="Messages" id="dmb" style="width:50px;height:50px">M</button></div></div>
</div><div id="layers"></div>
<script>document.querySelector('#react-root').firstElementChild.__reactProps$mock = { children: { props: { children: { props: { contextProviderProps: { featureSwitches: (window.__fs = { isTrue: (f) => true }) } } } } } };</script>
<script>
// X's reply box: a text box, a place for attachments, a file input (as X's has) and a Reply button that stays off while an attachment is still "uploading"
function mountComposer(l,id){
  l.innerHTML='<div role="dialog"><div data-testid="tweetTextarea_0" role="textbox" contenteditable="true" style="min-height:40px;border:1px solid #888"></div><div data-testid="attachments"></div><input type="file" data-testid="fileInput" multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime" style="display:none"><button data-testid="tweetButton" aria-disabled="true">Reply</button></div>';
  const ed=l.querySelector('[data-testid=tweetTextarea_0]'), b=l.querySelector('[data-testid=tweetButton]'), fi=l.querySelector('[data-testid=fileInput]'), at=l.querySelector('[data-testid=attachments]');
  let pending=0; const sync=()=>b.setAttribute('aria-disabled', (pending>0||!(ed.textContent.trim()||at.children.length))?'true':'false');
  ed.addEventListener('input',sync);
  fi.addEventListener('change',()=>{ for(const f of fi.files){ pending++; const d=document.createElement('div'); d.setAttribute('data-testid','attachment'); d.textContent=f.name+':'+f.size+':'+f.type; at.append(d); setTimeout(()=>{ pending--; sync(); }, window.__uploadMs||600); } sync(); });
  b.addEventListener('click',()=>{ if(b.getAttribute('aria-disabled')==='true') return; const r={to:id,text:ed.textContent}; if(at.children.length) r.files=[...at.children].map(c=>c.textContent); (window.__replies=window.__replies||[]).push(r); l.innerHTML=''; history.back(); });
}
</script>
${script}
${SCRIPTS}
</body></html>`;
}

// cfg: { title, tabs:[{label, feed}], selected, load (default true), dropdown:{tab, items, kind:'sort'|'media'} }
function timelinePage(cfg) {
  const tabs = cfg.tabs.map((t, i) => `<a role="tab"${t.href ? ` href="${t.href}"` : ''} aria-selected="${i === cfg.selected}" id="t${i}"><span style="font-weight:${i === cfg.selected ? 700 : 500}">${t.label}</span></a>`).join('');
  const body = `<div style="margin-left:480px;width:600px"><div data-testid="primaryColumn">${cfg.header || ''}<div role="tablist">${tabs}</div><div id="list" style="position:relative"></div></div></div>`;
  const script = `<script>
const CFG = ${JSON.stringify(cfg)};
const H=320; let items=[], feed=CFG.tabs[CFG.selected].feed, cursor=null, loading=false, done=false; const list=document.getElementById('list');
window.__actions=[]; const state={liked:new Set(),bm:new Set()};
const newer=()=> window.__pick==='popular'?1000: window.__pick==='photos'?2000:0;
async function load(first){ if(loading) return; loading=true;
  const v={count:20}; if(!first&&cursor) v.cursor=cursor; if(newer()) v.newer=newer();
  if(window.__delay) await new Promise(r=>setTimeout(r,window.__delay));
  const r=await fetch('/i/api/graphql/abc/'+feed,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({variables:v,queryId:'abc'})}); const j=await r.json();
  const ents=(j.data.home?j.data.home.home_timeline_urt:j.data.user.result.timeline.timeline).instructions[0].entries; if(first){items=[];done=false}
  cursor=null; for(const e of ents){ if(e.entryId.startsWith('cursor-bottom')) cursor=e.content.value; else if(!e.entryId.startsWith('promoted')) items.push(e.entryId.replace('tweet-','')); else items.push('ad'); }
  if(!cursor) done=true; loading=false; render(); }
function mk(id,i){ const c=document.createElement('div'); c.setAttribute('data-testid','cellInnerDiv'); c.dataset.i=i; c.style.cssText='position:absolute;width:100%;transform:translateY('+(i*H)+'px);height:'+H+'px';
  c.innerHTML='<article data-testid="tweet"><a href="/user/status/'+id+'"><time>t</time></a><div data-testid="tweetText">Original text '+id+'</div><div role="group">'
   +'<button data-testid="reply" onclick="openComposer(\\''+id+'\\')">r</button><button data-testid="retweet">rt</button>'
   +'<button data-testid="'+(state.liked.has(id)?'unlike':'like')+'" onclick="tog(\\'liked\\',\\''+id+'\\',this,\\'like\\',\\'unlike\\')">l</button>'
   +'<button data-testid="'+(state.bm.has(id)?'removeBookmark':'bookmark')+'" onclick="tog(\\'bm\\',\\''+id+'\\',this,\\'bookmark\\',\\'removeBookmark\\')">b</button></div><a href="/user'+(id%9)+'">profile</a></article>'; return c; }
function tog(set,id,btn,on,off){ const s=state[set]; if(s.has(id)){s.delete(id);btn.dataset.testid=on}else{s.add(id);btn.dataset.testid=off} __actions.push(set+':'+id); }
function openComposer(id){ __actions.push('reply:'+id); history.pushState({}, '', '/compose/post'); mountComposer(document.getElementById('layers'), id); }
let lastY=0, okSteps=0;
function render(){ const d=Math.abs(scrollY-lastY); lastY=scrollY; if(d>innerHeight*2) okSteps=0; else if(d>0) okSteps++;
  list.style.minHeight=(items.length*H)+'px';
  const first=Math.max(0,Math.floor((scrollY-600)/H)), last=Math.min(items.length-1,Math.ceil((scrollY+innerHeight+600)/H));
  const want=new Set(); for(let i=first;i<=last;i++) if(items[i]!=='ad') want.add(i);
  [...list.children].forEach(c=>{ if(window.__neverMount||!want.has(+c.dataset.i)) c.remove() });
  const have=new Set([...list.children].map(c=>+c.dataset.i));
  for(const i of want) if(!have.has(i)&&!window.__neverMount) list.append(mk(items[i],i));
  if(!done && okSteps>=2 && scrollY+innerHeight>=items.length*H-1500) load(false); }
// a post link opens its page (the page keeps showing the list, like a router that has not repainted yet) and fetches the conversation
window.__pg={}; const pv=document.createElement('div'); pv.id='postview'; pv.style.display='none'; list.after(pv); new MutationObserver(()=>{ if(!window.__spamCell||pv.querySelector('#spamcell')||pv.style.display==='none') return; const c=document.createElement('div'); c.setAttribute('data-testid','cellInnerDiv'); c.innerHTML='<div id="spamcell" role="button" tabindex="0">Show probable spam</div>'; c.firstChild.onclick=()=>{ window.__spam=(window.__spam||0)+1; }; pv.append(c); }).observe(pv,{childList:true,subtree:true}); new MutationObserver(()=>{ if(!window.__xlNoise) return; pv.querySelectorAll('[data-testid="tweetText"]').forEach(t=>{ if(t.__noisy) return; t.__noisy=1; ['Other option','Another choice'].forEach(x=>{ const d=document.createElement('div'); d.setAttribute('role','button'); d.tabIndex=0; d.textContent=x; t.after(d); }); }); }).observe(pv,{childList:true,subtree:true}); new MutationObserver(()=>{ if(!window.__xlLate) return; pv.querySelectorAll('[role="button"]').forEach(e=>{ if(/^Translate/.test(e.textContent.trim()) && !e.__late){ e.__late=1; const par=e.parentElement; e.remove(); setTimeout(()=>par.appendChild(e), window.__xlLate); } }); }).observe(pv,{childList:true,subtree:true});
function showPost(id){ list.style.display='none'; pv.style.display=''; pv.style.minHeight='2600px'; window.__pvAt=performance.now(); window.__pg[id]=1; pv.innerHTML=[0,1,2,3,4,5,6].map(k=>{ const i=k?Number(id)*10+k:id; return '<article data-testid="tweet" tabindex="'+(k?0:-1)+'" style="border-bottom:1px solid #333;padding:12px"><a href="/user/status/'+i+'"><time>t</time></a><div data-testid="tweetText">Post '+i+'</div><div role="group">'
  +'<button data-testid="reply" onclick="openComposer(\\''+i+'\\')">r</button><button data-testid="retweet">rt</button>'
  +'<button data-testid="'+(state.liked.has(String(i))?'unlike':'like')+'" onclick="tog(\\'liked\\',\\''+i+'\\',this,\\'like\\',\\'unlike\\')">l</button>'
  +'<button data-testid="bookmark" onclick="window.__bm=(window.__bm||0)+1">b</button></div>'+(window.__noTranslate?'':'<div><div role="button" tabindex="0" onclick="xlate(this)"><span>'+(window.__xlFrench?'Traduire le post':window.__xlShow?'Show translation':'Translate post')+'</span></div></div>')+'</article>'; }).join(''); }
document.addEventListener('click',e=>{ const b=e.target.closest&&e.target.closest('[data-testid="UserJoinDate"] [role="button"]'); if(!b||b.closest('#xmc-root')) return; const r=b.getBoundingClientRect(); const w=document.createElement('div'); w.innerHTML='<div style="position:fixed;inset:0"><div data-testid="aboutpop" style="position:absolute;left:'+Math.round(r.left+500)+'px;top:'+Math.round(r.bottom+250)+'px;width:240px;background:#222;color:#fff;padding:10px">About this account<br>Joined May 2010</div></div>'; document.getElementById('layers').append(w.firstChild); });
document.addEventListener('click',e=>{ const b=e.target.closest&&e.target.closest('[data-testid="userActions"]'); if(!b||b.closest('#xmc-root')) return; const r=b.getBoundingClientRect(), l=document.getElementById('layers'); l.innerHTML=''; const m=document.createElement('div'); m.setAttribute('role','menu'); m.style.cssText='position:fixed;left:'+Math.round(r.left+500)+'px;top:'+Math.round(r.bottom+300)+'px;background:#111;color:#fff;padding:8px;width:220px'; m.innerHTML='<div role="menuitem">About this account</div><div role="menuitem">Copy link to profile</div><div role="menuitem">Block @user7</div>'; window.__userMenu=(window.__userMenu||0)+1; l.append(m); });
document.addEventListener('click',e=>{ const b=e.target.closest&&e.target.closest('[data-testid$="-unfollow"]'); if(!b||b.closest('#xmc-root')||window.__noSheet) return; const who=b.getAttribute('data-testid').replace('-unfollow',''), l=document.getElementById('layers'); l.innerHTML=''; const sheet=()=>{ const d=document.createElement('div'); d.setAttribute('role','alertdialog'); d.setAttribute('aria-modal','true'); d.setAttribute('data-testid','confirmationSheetDialog'); d.style.cssText='position:fixed;left:40%;top:35%;background:#111;color:#fff;padding:16px;width:260px'; d.innerHTML='<div>Unfollow @'+who+'?</div><button data-testid="confirmationSheetConfirm" style="min-height:36px">Unfollow</button><button data-testid="confirmationSheetCancel" style="min-height:36px">Cancel</button>'; d.querySelector('[data-testid="confirmationSheetConfirm"]').onclick=()=>{ if(b.textContent.trim()) b.textContent='Follow'; b.setAttribute('data-testid',who+'-follow'); b.setAttribute('aria-label','Follow'); window.__unfollowed=(window.__unfollowed||0)+1; l.innerHTML=''; }; d.querySelector('[data-testid="confirmationSheetCancel"]').onclick=()=>{ l.innerHTML=''; }; window.__followAsked=(window.__followAsked||0)+1; l.append(d); }; if(window.__menuUnfollow){ const m=document.createElement('div'); m.setAttribute('role','menu'); m.style.cssText='position:fixed;left:40%;top:30%;background:#111;color:#fff;padding:8px'; m.innerHTML='<div role="menuitem" tabindex="0">Unfollow @'+who+'</div><div role="menuitem">Add/remove from Lists</div>'; m.firstChild.onclick=()=>{ l.innerHTML=''; sheet(); }; l.append(m); return; } sheet(); });
document.addEventListener('click',e=>{ const b=e.target.closest&&e.target.closest('[data-testid="subscribe"]'); if(!b||b.closest('#xmc-root')) return; window.__subscribed=(window.__subscribed||0)+1; });
window.__dropHeader=()=>{ const col=document.querySelector('[data-testid="primaryColumn"]'), hdr=col.firstElementChild, html=hdr.outerHTML; hdr.remove(); setTimeout(()=>{ const t=document.createElement('template'); t.innerHTML=html.replace(/<div /g,()=>'<div id="id__'+Math.random().toString(36).slice(2,8)+'" '); col.prepend(t.content.firstElementChild); },400); }; /* X walked away from its header and built it again: new ids */
function xlate(b){ window.__xl=(window.__xl||0)+1; const art=b.closest('article'); const tt=art.querySelector('[data-testid="tweetText"]'); setTimeout(()=>{ tt.textContent=(window.__xlFrench?'Traduit : ':'Translated: ')+tt.textContent; b.parentElement.remove(); if(window.__xlReal){ const s=document.createElement('div'); s.innerHTML='<span>Translated from Spanish</span><span>Show original</span>'; tt.before(s); return; } const s=document.createElement('div'); s.textContent=window.__xlFrench?'Traduit du japonais \u00b7 Afficher l\u2019original':'Translated from Japanese \u00b7 Show original'; art.append(s); },300); }
function showRoute(){ const m=/\\/status\\/(\\d+)$/.exec(location.pathname); if(m){ showPost(m[1]); fetch('/i/api/graphql/x/TweetDetail?variables='+encodeURIComponent(JSON.stringify({focalTweetId:m[1]}))); } else if(!/compose/.test(location.pathname)){ pv.style.display='none'; pv.innerHTML=''; list.style.display=''; } }
list.addEventListener('click',e=>{ const a=e.target.closest('a[href^="/user/status/"]'); if(!a) return; e.preventDefault(); if(window.__ignoreLinks>0){ window.__ignored=(window.__ignored||0)+1; return; } const id=a.getAttribute('href').split('/').pop(); history.pushState({}, '', '/home/user/status/'+id); window.peeked=(window.peeked||[]).concat(id); showPost(id); fetch('/i/api/graphql/x/TweetDetail?variables='+encodeURIComponent(JSON.stringify({focalTweetId:id}))); });
window.addEventListener('popstate',()=>{ window.backs=(window.backs||0)+1; showRoute(); });
addEventListener('scroll',()=>{ if(window.__noPages||pv.style.display==='none'||performance.now()-(window.__pvAt||0)<600||!/\\/status\\/\\d+$/.test(location.pathname)||window.__pgBusy) return; if(scrollY+innerHeight<document.documentElement.scrollHeight-700) return; const id=location.pathname.split('/').pop(); const n=(window.__pg[id]||1)+1; if(n>3) return; if(window.__needButton){ if(!pv.querySelector('#seeall')){ const c=document.createElement('div'); c.setAttribute('data-testid','cellInnerDiv'); c.innerHTML='<div id="seeall" role="button" tabindex="0">See all comments</div>'; pv.append(c); c.firstChild.onclick=()=>{ window.__btn=(window.__btn||0)+1; c.remove(); const m=(window.__pg[id]||1)+1; window.__pg[id]=m; fetch('/i/api/graphql/x/TweetDetail?variables='+encodeURIComponent(JSON.stringify({focalTweetId:id,cursor:'P'+m}))); }; } return; } window.__pg[id]=n; window.__pgBusy=true; fetch('/i/api/graphql/x/TweetDetail?variables='+encodeURIComponent(JSON.stringify({focalTweetId:id,cursor:'P'+n}))).finally(()=>{ window.__pgBusy=false; }); });
addEventListener('scroll',render); setInterval(render,150);
function select(i){ loading=false; cursor=null; done=false; CFG.tabs.forEach((t,k)=>{ const el=document.getElementById('t'+k); el.setAttribute('aria-selected', k===i?'true':'false'); el.firstChild.style.fontWeight = k===i?'700':'500'; }); feed=CFG.tabs[i].feed; window.scrollTo(0,0); load(true); }
function openDrop(){ const d=CFG.dropdown, l=document.getElementById('layers'); l.innerHTML=''; const m=document.createElement('div'); m.setAttribute('role','menu'); m.style.cssText='position:fixed;left:50%;bottom:40px;background:#000;border:1px solid #333;padding:8px'; window.__menuOpened=(window.__menuOpened||0)+1;
  const cur=(window.__pick||d.items[0]).toLowerCase();
  for(const it of d.items){ const e=document.createElement('div'); e.setAttribute('role','menuitem'); e.style.cssText='padding:8px 16px;cursor:pointer'; e.textContent=it; if(it.toLowerCase()===cur) e.insertAdjacentHTML('beforeend',' <svg width=14 height=14><path d="M1 7l4 4 8-8"/></svg>');
    e.addEventListener('click',()=>{ l.innerHTML=''; window.__pick=it.toLowerCase(); if(d.kind==='media') document.getElementById('t'+d.tab).firstChild.textContent=it; window.__picks=(window.__picks||0)+1; loading=false; cursor=null; done=false; window.scrollTo(0,0); load(true); }); m.append(e); }
  l.append(m); }
// X closes its menu when it sees a press outside it (set window.__strict to do it before anything else can react)
window.addEventListener('pointerdown',(e)=>{ if(window.__strict && !e.target.closest('[role=menu]')){ document.getElementById('layers').innerHTML=''; window.__strictClosed=(window.__strictClosed||0)+1; } },true);
CFG.tabs.forEach((t,i)=>{ document.getElementById('t'+i).onclick=()=>{ const sel=document.getElementById('t'+i).getAttribute('aria-selected')==='true'; if(CFG.dropdown && CFG.dropdown.tab===i && sel) openDrop(); else select(i); }; });
{ const fb=document.querySelector('[data-testid$="-unfollow"]'); if(fb) fb.addEventListener('click',()=>{ window.__unfollowPressed=(window.__unfollowPressed||0)+1; }); }
if(CFG.meta) fetch('/i/api/graphql/abc/'+CFG.meta+'?variables='+encodeURIComponent(JSON.stringify({listId:'123'})));
if(CFG.load!==false) load(true);
</script>`;
  return shell(cfg.title || 'Home / X', body, script);
}

// a post's own page: the post itself (tabindex -1) with its action row, and six replies whose like and reply buttons work
function postPage(id) {
  const art = (i, tab) => `<article data-testid="tweet" tabindex="${tab}" style="border-bottom:1px solid #333;padding:12px"><a href="/user/status/${i}"><time>t</time></a><div data-testid="tweetText">Post ${i}</div>${tab === -1 ? '<div><div class="r-blur" id="blurred" style="width:80px;height:40px;background:#c33">picture</div><div id="notice">cover</div></div>' : ''}${tab === -1 ? '<div id="agebox" style="width:300px;height:140px"><div><span>Age-restricted adult content. This content might not be appropriate for everyone.</span><div role="button" tabindex="0" onclick="window.__gate2=(window.__gate2||0)+1"><span>Show</span></div></div></div>' : ''}${tab === -1 ? '<div><span>The following media includes potentially sensitive content.</span><div role="button" tabindex="0" onclick="window.__gate=(window.__gate||0)+1"><span>Show</span></div></div>' : ''}
 <button aria-label="Grok actions" style="float:right">G</button>
 <div role="group" id="id__${i}" style="display:flex;justify-content:space-between;margin-top:30px"><div><button data-testid="reply" onclick="openComposer('${i}')">r</button></div><div><button data-testid="retweet">rt</button></div><div><button data-testid="like" onclick="tog('${i}',this)">l</button></div><div><button data-testid="bookmark" onclick="window.__bm=(window.__bm||0)+1">b</button></div><div style=""><button aria-label="Share post">s</button></div></div></article>`;
  const body = `<div style="margin-left:480px;width:600px"><div data-testid="primaryColumn">${art(id, -1)}${[1, 2, 3, 4, 5, 6].map((k) => art(Number(id) * 10 + k, 0)).join('')}</div></div>`;
  const script = `<script>
window.__actions=[]; const liked=new Set();
function tog(id,btn){ if(liked.has(id)){liked.delete(id);btn.dataset.testid='like'}else{liked.add(id);btn.dataset.testid='unlike'} btn.setAttribute('data-testid',btn.dataset.testid); __actions.push('like:'+id); }
function openComposer(id){ __actions.push('reply:'+id); history.pushState({}, '', '/compose/post'); mountComposer(document.getElementById('layers'), id); }
fetch('/i/api/graphql/x/TweetDetail?variables='+encodeURIComponent(JSON.stringify({focalTweetId:'${id}'})));</script>`;
  return shell('Post / X', body, script);
}

const HOME = { title: 'Home / X', tabs: [{ label: 'For you', feed: 'HomeTimeline' }, { label: 'Following', feed: 'HomeLatestTimeline' }], selected: 0 };

function pageFor(path) {
  const p = path.replace(/\/+$/, '') || '/';
  if (p === '/home') return timelinePage(HOME);
  if (p === '/menu') return timelinePage({ ...HOME, title: 'Menu / X', dropdown: { tab: 1, items: ['Recent', 'Popular'], kind: 'sort' } });
  if (p === '/user/media') return timelinePage({ title: 'user / Media / X', tabs: [{ label: 'Posts' }, { label: 'Replies' }, { label: 'Reposts' }, { label: 'Videos', feed: 'UserMedia' }], selected: 3, dropdown: { tab: 3, items: ['Videos', 'Photos'], kind: 'media' } });
  if (p === '/user1/likes') return timelinePage({ title: 'user1 / Likes / X', tabs: [{ label: 'Posts' }, { label: 'Replies' }, { label: 'Media' }, { label: 'Likes', feed: 'Likes' }], selected: 3 });
  if (p === '/i/bookmarks') return timelinePage({ title: 'Bookmarks / X', tabs: [{ label: 'Bookmarks', feed: 'Bookmarks' }], selected: 0 });
  if (p === '/user1/followers') return timelinePage({ title: 'user1 / Followers / X', tabs: [{ label: 'Followers you know' }, { label: 'Followers', feed: 'Followers' }, { label: 'Verified Followers' }], selected: 1 });
  if (p === '/user1/following') return timelinePage({ title: 'user1 / Following / X', tabs: [{ label: 'Following', feed: 'Following' }], selected: 0 });
  if (p === '/i/lists/123/members') return timelinePage({ title: 'List members / X', tabs: [{ label: 'Members', feed: 'ListMembers' }], selected: 0 });
  if (p === '/search') return timelinePage({ title: 'Search / X', tabs: [{ label: 'Top' }, { label: 'Latest', feed: 'SearchTimeline' }], selected: 1 });
  if (p === '/explore') return timelinePage({ title: 'Explore / X', tabs: [{ label: 'For you', feed: 'ExplorePage' }, { label: 'Trending', feed: 'ExplorePage' }], selected: 0 });
  if (p === '/threads') return timelinePage({ title: 'threads / X', tabs: [{ label: 'Posts', feed: 'ThreadsTimeline' }], selected: 0 });
  if (p === '/i/lists/123') return timelinePage({ title: 'List / X', tabs: [{ label: 'Posts', feed: 'ListLatestTimeline' }], selected: 0, meta: 'ListByRestId' });
  if (p === '/user5') return timelinePage({ title: 'User Five (@user5) / X', tabs: [{ label: 'Posts', feed: 'UserTweets' }], selected: 0, meta: 'UserByScreenName' });
  if (p === '/user7') return timelinePage({ title: 'user7 / X', tabs: [{ label: 'Posts', feed: 'UserTweets' }], selected: 0, header: '<div><a href="/user7/header_photo"><img alt="" src="/img/b7.svg" width="600" height="200"></a><div data-testid="UserAvatar-Container-user7"><img alt="" src="/img/a7_normal.svg" width="60" height="60"></div><button data-testid="userActions" aria-label="More" style="width:36px;height:36px">...</button><button data-testid="user7-unfollow" style="min-width:60px;min-height:36px">Following</button><div data-testid="UserName"><span>Seven Name</span><span>@user7</span></div><div data-testid="UserDescription">Bio seven <a href="https://example.org/" target="_blank" rel="noopener">example.org</a></div><div data-testid="UserProfileHeader_Items"><span>Somewhere</span><span data-testid="UserJoinDate"><span role="button" tabindex="0">Joined May 2010<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 1l5 4-5 4"/></svg></span></span></div><a href="/user7/following" style="text-decoration:none">12 Following</a> <a href="/user7/verified_followers" style="text-decoration:none">34 Followers</a></div>' });
  if (p === '/user9') return timelinePage({ title: 'user9 / X', tabs: [{ label: 'Posts', feed: 'UserTweets' }], selected: 0, header: '<div><a href="/user9/header_photo"><img alt="" src="/img/b7.svg" width="600" height="200"></a><div data-testid="UserAvatar-Container-user9"><img alt="" src="/img/a7_normal.svg" width="60" height="60"></div><div><button data-testid="userActions" aria-label="More" style="width:36px;height:36px">...</button><button data-testid="user9-unfollow" aria-label="Following" style="width:36px;height:36px"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 8l4 4 8-8"/></svg></button><button data-testid="subscribe" style="min-width:80px;min-height:36px">Subscribe</button></div><div data-testid="UserName"><span>Nine Name</span><span>@user9</span></div><div data-testid="UserDescription">Bio nine</div><a href="/user9/following" style="text-decoration:none">12 Following</a> <a href="/user9/verified_followers" style="text-decoration:none">34 Followers</a></div>' });
  if (p === '/user7/reposts') return timelinePage({ title: 'user7 / X', tabs: [{ label: 'Posts', href: '/user7', feed: 'UserTweets' }, { label: 'Reposts', href: '/user7/reposts', feed: 'UserTweets' }], selected: 1 });
  if (p === '/user6/with_replies') return timelinePage({ title: 'user6 / X', tabs: [{ label: 'Posts', feed: 'UserTweets' }, { label: 'Replies', feed: 'UserTweetsAndReplies' }], selected: 1 });
  if (p === '/dupes') return timelinePage({ title: 'dupes / X', tabs: [{ label: 'Posts', feed: 'DupesTimeline' }], selected: 0 });
  if (p === '/nofeed') return timelinePage({ ...HOME, title: 'No feed / X', load: false });
  const m = /^\/user\/status\/(\d+)$/.exec(p);
  if (m) return postPage(m[1]);
  return null;
}

module.exports = { pageFor };
