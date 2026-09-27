const $=(id)=>document.getElementById(id);
const state={token:sessionStorage.getItem('alchemic_social_hub_token')||'',dashboard:null,config:null,data:null,inbox:{social:[],email:[]},inboxFilter:'all',selected:null};

const DEMO_MODE=location.hostname.endsWith('github.io');
const DEMO={
  dashboard:{summary:{views:284600,social_conversations:147,content_leads:62,email_human_replies:24,pending_social_replies:7,social_unread:12,likes:18400,comments:2130,shares:921,saves:1640,link_clicks:438},outreachBridge:true,platforms:[{platform:'instagram_reels',posts:84,views:181200,comments:1380,clicks:319,conversations:103,leads:46},{platform:'youtube_shorts',posts:42,views:73400,comments:510,clicks:78,conversations:25,leads:10},{platform:'tiktok',posts:38,views:30000,comments:240,clicks:41,conversations:19,leads:6}],recentSocial:[{contact_display_name:'Sarah M.',contact_username:'sarahbuilds',last_message:'CLASS — send me the invite',last_message_at:new Date().toISOString(),platform:'instagram_reels'},{contact_display_name:'Mike R.',contact_username:'mikerunsagency',last_message:'How does the content distribution part work?',last_message_at:new Date(Date.now()-3600000).toISOString(),platform:'instagram_reels'}],recentEmail:[{email_from:'alex@example.com',message:'Yes, I am open to seeing the ideas.',timestamp:new Date(Date.now()-7200000).toISOString()}],topPosts:[{caption:'2 calls a week vs 8 calls a day',platform:'instagram_reels',username:'julian',views:48200,likes:4100,comments:510,shares:198,saves:321,link_clicks:146,leads:22,external_post_url:'#',clip_variant_id:'traffic01'},{caption:'The sale starts BEFORE the sales call',platform:'youtube_shorts',username:'julian',views:33100,likes:1900,comments:201,shares:91,saves:140,link_clicks:54,leads:8,external_post_url:'#',clip_variant_id:'sales02'},{caption:'One post generated 50+ potential leads',platform:'instagram_reels',username:'julian',views:27600,likes:2200,comments:338,shares:102,saves:194,link_clicks:89,leads:13,external_post_url:'#',clip_variant_id:'organic03'}]},
  config:{providers:{instagram:{ready:true},youtube:{ready:true}},callbacks:{metaWebhook:'https://YOUR-SITE.netlify.app/api/meta/webhook'}},
  data:{accounts:[{id:'ig-demo',platform:'instagram_reels',display_name:'Julian / Alchemic',username:'julian',capabilities_json:{publish:true,messages_read:true,messages_send:true},webhook_status:'connected',health_status:'healthy',membership:{campaign_name:'Live Class Sprint'}},{id:'yt-demo',platform:'youtube_shorts',display_name:'Alchemic YouTube',username:'alchemic',capabilities_json:{publish:true},webhook_status:'—',health_status:'healthy',membership:{campaign_name:'Live Class Sprint'}}],campaigns:[{id:'campaign-demo',name:'Live Class Sprint'}],pools:[{id:'pool-demo',name:'Main Creator Pool'}]},
  inbox:{social:[{conversation_id:'conv-demo-1',last_message_at:new Date().toISOString(),contact_display_name:'Sarah M.',contact_username:'sarahbuilds',last_message:'CLASS — send me the invite',platform:'instagram_reels',unread_count:1},{conversation_id:'conv-demo-2',last_message_at:new Date(Date.now()-3600000).toISOString(),contact_display_name:'Mike R.',contact_username:'mikerunsagency',last_message:'How does the content distribution part work?',platform:'instagram_reels',unread_count:0}],email:[{id:'email-demo-1',timestamp:new Date(Date.now()-7200000).toISOString(),email_from:'alex@example.com',email_subject:'Re: collab inquiry',message:'Yes, I am open to seeing the ideas.'}]},
  conversations:{'conv-demo-1':{conversation:{contact_display_name:'Sarah M.',contact_username:'sarahbuilds',platform:'instagram_reels',account_username:'julian',lead_status:'qualified'},messages:[{direction:'inbound',body:'CLASS',sent_at:new Date(Date.now()-120000).toISOString(),delivery_status:'received',message_type:'comment',platform_message_id:'comment-demo-1'},{direction:'outbound',body:'Got you — I’m teaching the full system live this week. Want the free invite?',sent_at:new Date(Date.now()-60000).toISOString(),delivery_status:'sent',message_type:'dm'},{direction:'inbound',body:'Yes, send it over.',sent_at:new Date().toISOString(),delivery_status:'received',message_type:'dm'}],outbox:[]},'conv-demo-2':{conversation:{contact_display_name:'Mike R.',contact_username:'mikerunsagency',platform:'instagram_reels',account_username:'julian',lead_status:'new'},messages:[{direction:'inbound',body:'How does the content distribution part work?',sent_at:new Date(Date.now()-3600000).toISOString(),delivery_status:'received',message_type:'dm'}],outbox:[]}}
};

async function api(path,options={}){
  if(DEMO_MODE){
    if(path.startsWith('/api/dashboard')) return DEMO.dashboard;
    if(path.startsWith('/api/config')) return DEMO.config;
    if(path.startsWith('/api/data')) return DEMO.data;
    if(path.startsWith('/api/inbox')) return DEMO.inbox;
    if(path.startsWith('/api/conversation')){const id=new URL(path,location.origin).searchParams.get('id');return DEMO.conversations[id]||DEMO.conversations['conv-demo-1'];}
    if(path.startsWith('/api/social/reply')||path.startsWith('/api/social/lead-status')||path.startsWith('/api/metrics/sync')) return {ok:true,demo:true};
    if(path.startsWith('/api/oauth/start')) throw new Error('OAuth is disabled in the GitHub Pages demo. Use the Netlify deployment for live connections.');
    return {ok:true,demo:true};
  }
  const headers={...(options.headers||{}),'x-connector-admin-token':state.token};
  if(options.body && typeof options.body!=='string'){headers['content-type']='application/json';options={...options,body:JSON.stringify(options.body)}}
  const r=await fetch(path,{...options,headers}); const payload=await r.json().catch(()=>({})); if(!r.ok)throw new Error(payload.error||`Request failed (${r.status})`); return payload;
}
const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(n)=>Intl.NumberFormat('en',{notation:Number(n)>=10000?'compact':'standard',maximumFractionDigits:1}).format(Number(n||0));
const when=(x)=>{if(!x)return'';const d=new Date(x);const diff=Date.now()-d.getTime();if(diff<60000)return'now';if(diff<3600000)return`${Math.floor(diff/60000)}m`;if(diff<86400000)return`${Math.floor(diff/3600000)}h`;return d.toLocaleDateString()};
const platformLabel=(p)=>({instagram_reels:'Instagram',youtube_shorts:'YouTube',tiktok:'TikTok',facebook:'Facebook'}[p]||p||'Unknown');

function setView(name){
  document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===`view-${name}`));
  document.querySelectorAll('.nav').forEach(x=>x.classList.toggle('active',x.dataset.view===name));
  $('view-title').textContent={overview:'Overview',inbox:'Unified Inbox',content:'Content Performance',accounts:'Connected Accounts'}[name]||name;
  if(name==='inbox')loadInbox(); if(name==='accounts')loadAccounts();
}

function metric(label,value){return `<div class="metric"><span>${esc(label)}</span><strong>${fmt(value)}</strong></div>`}
function renderOverview(){
  const d=state.dashboard||{}; const s=d.summary||{};
  $('summary-cards').innerHTML=[metric('Views',s.views),metric('Social conversations',s.social_conversations),metric('Content leads',s.content_leads),metric('Email replies',s.email_human_replies),metric('Pending replies',s.pending_social_replies)].join('');
  $('unread-pill').textContent=fmt(s.social_unread||0);
  $('email-bridge').textContent=d.outreachBridge?'Email bridge: read-only':'Email bridge: not configured';
  $('platform-table').innerHTML=(d.platforms||[]).length?(d.platforms||[]).map(x=>`<tr><td>${esc(platformLabel(x.platform))}</td><td>${fmt(x.posts)}</td><td>${fmt(x.views)}</td><td>${fmt(x.comments)}</td><td>${fmt(x.clicks)}</td><td>${fmt(x.conversations)}</td><td>${fmt(x.leads)}</td></tr>`).join(''):'<tr><td colspan="7">No published-post metrics yet. Run Sync metrics after the Distributor has published posts.</td></tr>';
  const activity=[];
  for(const x of d.recentSocial||[])activity.push({name:x.contact_display_name||x.contact_username||'Social lead',text:x.last_message||'',time:x.last_message_at,source:platformLabel(x.platform)});
  for(const x of d.recentEmail||[])activity.push({name:x.email_from||'Email lead',text:x.message||'',time:x.timestamp,source:'Email'});
  activity.sort((a,b)=>new Date(b.time||0)-new Date(a.time||0));
  $('recent-activity').innerHTML=activity.slice(0,15).map(x=>`<div class="activity-item"><div><strong>${esc(x.name)}</strong> <span class="source-chip">${esc(x.source)}</span></div><p>${esc(x.text)}</p><span>${esc(when(x.time))}</span></div>`).join('')||'<div class="empty"><p>No inbound activity yet.</p></div>';
  $('top-posts').innerHTML=renderPostRows((d.topPosts||[]).slice(0,20),false);
  $('content-table').innerHTML=renderPostRows(d.topPosts||[],true);
  $('content-summary').innerHTML=[metric('Published posts',(d.topPosts||[]).length),metric('Views',s.views),metric('Engagement',Number(s.likes||0)+Number(s.comments||0)+Number(s.shares||0)+Number(s.saves||0)),metric('Link clicks',s.link_clicks),metric('Leads',s.content_leads)].join('');
}
function renderPostRows(rows,detailed){
  if(!rows.length)return `<tr><td colspan="${detailed?10:7}">No post metrics yet.</td></tr>`;
  return rows.map(x=>{const post=x.external_post_url?`<a class="post-link" href="${esc(x.external_post_url)}" target="_blank">${esc((x.caption||x.external_post_id||'Published post').slice(0,55))}</a>`:esc((x.caption||x.external_post_id||'Published post').slice(0,55));const eng=Number(x.likes||0)+Number(x.comments||0)+Number(x.shares||0)+Number(x.saves||0);if(detailed)return `<tr><td>${post}</td><td>${esc(x.clip_variant_id?String(x.clip_variant_id).slice(0,8):'—')}</td><td>${esc(platformLabel(x.platform))}</td><td>${fmt(x.views)}</td><td>${fmt(x.likes)}</td><td>${fmt(x.comments)}</td><td>${fmt(x.shares)}</td><td>${fmt(x.saves)}</td><td>${fmt(x.link_clicks)}</td><td>${fmt(x.leads)}</td></tr>`;return `<tr><td>${post}</td><td>${esc(platformLabel(x.platform))}</td><td>${esc(x.username||'—')}</td><td>${fmt(x.views)}</td><td>${fmt(eng)}</td><td>${fmt(x.link_clicks)}</td><td>${fmt(x.leads)}</td></tr>`}).join('');
}

async function loadOverview(){state.dashboard=await api('/api/dashboard');renderOverview()}

function mergedThreads(){
  const items=[];
  if(state.inboxFilter!=='email')for(const x of state.inbox.social||[])items.push({kind:'social',id:x.conversation_id,time:x.last_message_at||x.last_inbound_at,name:x.contact_display_name||x.contact_username||'Social lead',text:x.last_message||'',source:platformLabel(x.platform),unread:x.unread_count||0,data:x});
  if(state.inboxFilter!=='social')for(const x of state.inbox.email||[])items.push({kind:'email',id:x.id,time:x.timestamp,name:x.email_from||'Email lead',text:x.message||'',source:'Email',unread:0,data:x});
  return items.sort((a,b)=>new Date(b.time||0)-new Date(a.time||0));
}
function renderThreads(){
  const items=mergedThreads(); $('thread-list').innerHTML=items.map(x=>`<div class="thread ${state.selected?.id===x.id?'active':''}" data-kind="${x.kind}" data-id="${esc(x.id)}"><div class="thread-top"><strong>${esc(x.name)}</strong><span><span class="source-chip">${esc(x.source)}</span> ${x.unread?`<span class="pill">${x.unread}</span>`:''}</span></div><p>${esc(x.text)}</p><small>${esc(when(x.time))}</small></div>`).join('')||'<div class="empty"><p>No replies loaded.</p></div>';
  document.querySelectorAll('.thread').forEach(el=>el.addEventListener('click',()=>openThread(el.dataset.kind,el.dataset.id)));
}
async function loadInbox(){const payload=await api('/api/inbox?source=all&limit=150');state.inbox=payload;renderThreads()}
async function openThread(kind,id){
  state.selected={kind,id};renderThreads();$('conversation-empty').hidden=true;$('conversation-wrap').hidden=false;
  if(kind==='email'){
    const x=(state.inbox.email||[]).find(y=>String(y.id)===String(id)); $('conversation-name').textContent=x?.email_from||'Email lead'; $('conversation-meta').textContent=`Email · ${x?.email_subject||'No subject'} · read-only bridge`; $('lead-status-select').value='new';$('lead-status-select').disabled=true; $('messages').innerHTML=`<div class="message"><div>${esc(x?.message||'')}</div><small>${esc(x?.timestamp?new Date(x.timestamp).toLocaleString():'')}</small></div>`; $('reply-form').hidden=true; return;
  }
  const payload=await api(`/api/conversation?id=${encodeURIComponent(id)}`); state.selected.detail=payload; const c=payload.conversation; $('conversation-name').textContent=c.contact_display_name||c.contact_username||'Social lead'; $('conversation-meta').textContent=`${platformLabel(c.platform)} · @${c.account_username||'account'}`; $('lead-status-select').disabled=false;$('lead-status-select').value=c.lead_status||'new'; $('reply-form').hidden=false;
  const messages=[...(payload.messages||[])]; for(const q of payload.outbox||[])if(q.status==='pending'||q.status==='sending')messages.push({direction:'outbound',body:q.body,sent_at:q.queued_at,delivery_status:q.status,message_type:'queued'});
  messages.sort((a,b)=>new Date(a.sent_at||0)-new Date(b.sent_at||0));
  $('messages').innerHTML=messages.map(m=>`<div class="message ${m.direction==='outbound'?'outbound':''}"><div>${esc(m.body||`[${m.message_type||'message'}]`)}</div><small>${esc(when(m.sent_at))} · ${esc(m.delivery_status||'')}</small></div>`).join(''); $('messages').scrollTop=$('messages').scrollHeight;
}

async function loadAccounts(){
  const [config,data]=await Promise.all([api('/api/config'),api('/api/data')]);state.config=config;state.data=data;
  $('ig-provider-status').textContent=config.providers.instagram.ready?'Configured':'Not configured';$('yt-provider-status').textContent=config.providers.youtube.ready?'Configured':'Not configured';$('instagram-connect').disabled=!config.providers.instagram.ready;$('youtube-connect').disabled=!config.providers.youtube.ready;$('meta-webhook-url').textContent=config.callbacks.metaWebhook;
  const fill=(id,rows,label)=>{const s=$(id),first=s.options[0].outerHTML;s.innerHTML=first+(rows||[]).map(r=>`<option value="${esc(r.id)}">${esc(label(r))}</option>`).join('')};fill('campaign',data.campaigns,x=>x.name);fill('pool',data.pools,x=>x.name);
  $('account-count').textContent=`${data.accounts.length} accounts`;
  $('accounts-table').innerHTML=data.accounts.length?data.accounts.map(a=>{const c=a.capabilities_json||{};return `<tr><td><strong>${esc(a.display_name||a.username||a.platform_account_id)}</strong><div class="small-text">${esc(a.username||a.platform_account_id)}</div></td><td>${esc(platformLabel(a.platform))}</td><td>${esc(a.membership?.campaign_name||'Unassigned')}</td><td class="${c.publish?'good':'warn'}">${c.publish?'Enabled':'—'}</td><td class="${c.messages_read||c.messages_send?'good':'warn'}">${c.messages_read||c.messages_send?'Enabled':'Upgrade OAuth'}</td><td>${esc(a.webhook_status||'—')}</td><td>${esc(a.health_status||'—')}</td></tr>`}).join(''):'<tr><td colspan="7">No connected accounts.</td></tr>';
}
function settings(){return{campaignId:$('campaign').value,poolId:$('pool').value,dailyLimit:Number($('daily-limit').value),weeklyLimit:Number($('weekly-limit').value),minGapMinutes:Number($('min-gap').value)}}
async function connect(provider){const s=settings();const p=new URLSearchParams({provider,...Object.fromEntries(Object.entries(s).map(([k,v])=>[k,String(v)]))});const r=await api(`/api/oauth/start?${p}`);location.assign(r.authorizationUrl)}

async function boot(){
  await Promise.all([loadOverview(),loadAccounts()]); $('unlock').hidden=true;$('app').hidden=false; sessionStorage.setItem('alchemic_social_hub_token',state.token);
}
$('unlock-form').addEventListener('submit',async e=>{e.preventDefault();$('unlock-error').hidden=true;state.token=$('admin-token').value.trim();try{await boot()}catch(err){$('unlock-error').textContent=err.message;$('unlock-error').hidden=false}});
document.querySelectorAll('.nav').forEach(x=>x.addEventListener('click',()=>setView(x.dataset.view)));
document.querySelectorAll('.seg').forEach(x=>x.addEventListener('click',()=>{document.querySelectorAll('.seg').forEach(y=>y.classList.toggle('active',y===x));state.inboxFilter=x.dataset.inbox;renderThreads()}));
$('reload-inbox').addEventListener('click',()=>loadInbox().catch(e=>alert(e.message)));
$('refresh-all').addEventListener('click',()=>Promise.all([loadOverview(),loadInbox(),loadAccounts()]).catch(e=>alert(e.message)));
$('sync-metrics').addEventListener('click',async()=>{const b=$('sync-metrics');b.disabled=true;b.textContent='Syncing…';try{await api('/api/metrics/sync',{method:'POST',body:{limit:100}});await loadOverview()}catch(e){alert(e.message)}finally{b.disabled=false;b.textContent='Sync metrics'}});
$('instagram-connect').addEventListener('click',()=>connect('instagram').catch(e=>alert(e.message)));$('youtube-connect').addEventListener('click',()=>connect('youtube').catch(e=>alert(e.message)));
$('reply-form').addEventListener('submit',async e=>{e.preventDefault();if(state.selected?.kind!=='social')return;const body=$('reply-body').value.trim();if(!body)return;const b=e.currentTarget.querySelector('button');b.disabled=true;try{const msgs=state.selected.detail?.messages||[];const queued=state.selected.detail?.outbox||[];const latestInbound=[...msgs].reverse().find(m=>m.direction==='inbound');const hasOutbound=msgs.some(m=>m.direction==='outbound')||queued.some(q=>['pending','sending','sent'].includes(q.status));const usePrivate=latestInbound?.message_type==='comment'&&!hasOutbound;await api('/api/social/reply',{method:'POST',body:{conversationId:state.selected.id,body,replyMode:usePrivate?'private_reply':'dm',targetPlatformId:usePrivate?latestInbound.platform_message_id:null}});$('reply-body').value='';await openThread('social',state.selected.id);await loadOverview()}catch(err){alert(err.message)}finally{b.disabled=false}});
if(DEMO_MODE){state.token='demo';boot().catch(console.error)}else if(state.token)boot().catch(()=>{sessionStorage.removeItem('alchemic_social_hub_token');state.token='' });

$('lead-status-select').addEventListener('change',async()=>{if(state.selected?.kind!=='social')return;try{await api('/api/social/lead-status',{method:'POST',body:{conversationId:state.selected.id,status:$('lead-status-select').value}});await loadOverview();await loadInbox()}catch(e){alert(e.message)}});
