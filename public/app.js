const $=id=>document.getElementById(id);
const state={dashboard:null,data:null,config:null,view:'overview'};
const fmt=n=>Intl.NumberFormat('en',{notation:Number(n)>=10000?'compact':'standard',maximumFractionDigits:1}).format(Number(n||0));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const platformLabel=p=>({instagram_reels:'Instagram',youtube_shorts:'YouTube',tiktok_video:'TikTok',facebook:'Facebook'}[p]||p||'Unknown');

async function api(path){
  const r=await fetch(path);
  const payload=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(payload.error||`Request failed (${r.status})`);
  return payload;
}

function setView(name){
  state.view=name;
  document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===`view-${name}`));
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===name));
  const titles={
    overview:['Media Dashboard','Track content, distribution, conversations and leads from one place.'],
    content:['Content Performance','See which clips, channels and platforms are producing attention and leads.'],
    inbox:['Unified Inbox','All social conversations will live in one place.'],
    leads:['Lead Pipeline','Track content-generated leads from first engagement to client.'],
    accounts:['Connected Channels','Manage the accounts already connected to your Distributor.']
  };
  $('view-title').textContent=titles[name][0];
  $('view-subtitle').textContent=titles[name][1];
}

function stat(label,value,tone,icon){
  return `<div class="stat-card"><div class="stat-icon ${tone}">${icon}</div><div><strong>${fmt(value)}</strong><span>${esc(label)}</span></div></div>`;
}

function renderOverview(){
  const d=state.dashboard||{},s=d.summary||{},accounts=state.data?.accounts||[];
  $('summary-cards').innerHTML=[
    stat('Total Views',s.views,'blue','▶'),
    stat('Engagements',Number(s.likes||0)+Number(s.comments||0)+Number(s.shares||0)+Number(s.saves||0),'green','↗'),
    stat('Conversations',s.social_conversations,'orange','✉'),
    stat('Content Leads',s.content_leads,'purple','◉'),
    stat('Link Clicks',s.link_clicks,'cyan','↗')
  ].join('');

  $('unread-pill').textContent=fmt(s.social_unread||0);
  $('email-bridge').textContent=d.outreachBridge?'Connected, read only':'Not configured';
  $('email-bridge').className=d.outreachBridge?'ok':'pending';

  const platforms=d.platforms||[];
  const maxViews=Math.max(1,...platforms.map(x=>Number(x.views||0)));
  $('platform-bars').innerHTML=platforms.length?platforms.map(x=>`
    <div class="platform-row">
      <div class="platform-name">${esc(platformLabel(x.platform))}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2,Math.round(Number(x.views||0)/maxViews*100))}%"></div></div>
      <div class="bar-stat"><strong>${fmt(x.views)}</strong><span>views</span></div>
      <div class="bar-stat"><strong>${fmt(x.leads)}</strong><span>leads</span></div>
    </div>`).join(''):'<div class="empty-row">No post metrics yet. Once metrics sync is active, platform performance will populate here.</div>';

  $('pipeline-boxes').innerHTML=[
    ['Views',s.views],['Conversations',s.social_conversations],['Leads',s.content_leads],['Qualified',s.qualified_social],['Booked',0]
  ].map((x,i)=>`${i?'<div class="pipeline-arrow">↓</div>':''}<div class="pipeline-step"><span>${x[0]}</span><strong>${fmt(x[1])}</strong></div>`).join('');

  $('top-posts').innerHTML=renderPosts((d.topPosts||[]).slice(0,10),false);

  $('channel-preview').innerHTML=accounts.length?accounts.slice(0,6).map(a=>`
    <div class="channel-mini">
      <div><div class="channel-dot">${platformLabel(a.platform).slice(0,2).toUpperCase()}</div><div><strong>${esc(a.username||'Unnamed channel')}</strong><span>${esc(platformLabel(a.platform))}</span></div></div>
      <span class="status-chip ${a.is_active!==false?'active':'inactive'}">${a.is_active!==false?'Active':'Paused'}</span>
    </div>`).join(''):'<div class="empty-row">No connected channels found.</div>';
}

function renderPosts(rows,detailed){
  if(!rows.length)return `<tr><td class="empty-row" colspan="${detailed?9:7}">No content performance data yet.</td></tr>`;
  return rows.map(x=>{
    const name=esc((x.caption||x.external_post_id||'Published post').slice(0,64));
    const post=x.external_post_url?`<a class="post-link" href="${esc(x.external_post_url)}" target="_blank">${name}</a>`:name;
    const eng=Number(x.likes||0)+Number(x.comments||0)+Number(x.shares||0)+Number(x.saves||0);
    if(detailed)return `<tr><td>${post}</td><td><span class="platform-chip">${esc(platformLabel(x.platform))}</span></td><td>${esc(x.username||'—')}</td><td>${fmt(x.views)}</td><td>${fmt(x.likes)}</td><td>${fmt(x.comments)}</td><td>${fmt(x.shares)}</td><td>${fmt(x.link_clicks)}</td><td>${fmt(x.leads)}</td></tr>`;
    return `<tr><td>${post}</td><td><span class="platform-chip">${esc(platformLabel(x.platform))}</span></td><td>${esc(x.username||'—')}</td><td>${fmt(x.views)}</td><td>${fmt(eng)}</td><td>${fmt(x.link_clicks)}</td><td>${fmt(x.leads)}</td></tr>`;
  }).join('');
}

function renderContent(){
  const d=state.dashboard||{},s=d.summary||{};
  const filter=$('content-platform-filter')?.value||'all';
  const rows=(d.topPosts||[]).filter(x=>filter==='all'||x.platform===filter);
  $('content-summary').innerHTML=[
    stat('Published Posts',rows.length,'blue','▶'),
    stat('Views',rows.reduce((n,x)=>n+Number(x.views||0),0),'green','↗'),
    stat('Comments',rows.reduce((n,x)=>n+Number(x.comments||0),0),'orange','✉'),
    stat('Link Clicks',rows.reduce((n,x)=>n+Number(x.link_clicks||0),0),'purple','↗'),
    stat('Leads',rows.reduce((n,x)=>n+Number(x.leads||0),0),'cyan','◉')
  ].join('');
  $('content-table').innerHTML=renderPosts(rows,true);
}

function renderAccounts(){
  const data=state.data||{accounts:[]},config=state.config||{providers:{}};
  const accounts=data.accounts||[];
  $('account-count').textContent=`${accounts.length} channels`;
  $('ig-provider-status').textContent=config.providers?.instagram?.ready?'Connector configured':'OAuth keys not added yet';
  $('yt-provider-status').textContent=config.providers?.youtube?.ready?'Connector configured':'OAuth keys not added yet';
  $('accounts-table').innerHTML=accounts.length?accounts.map(a=>{
    const c=a.capabilities_json||{};
    return `<tr>
      <td><strong>${esc(a.username||a.display_name||'Unnamed')}</strong></td>
      <td><span class="platform-chip">${esc(platformLabel(a.platform))}</span></td>
      <td><span class="status-chip ${a.is_active!==false?'active':'inactive'}">${a.is_active!==false?'Active':'Paused'}</span></td>
      <td>${c.publish?'Enabled':'—'}</td>
      <td>${c.messages_read||c.messages_send?'Enabled':'Not connected'}</td>
      <td>${esc(a.webhook_status||'not configured')}</td>
      <td>${fmt(a.daily_limit||0)}</td>
    </tr>`;
  }).join(''):'<tr><td class="empty-row" colspan="7">No connected channels found.</td></tr>';
}

function renderLeadCounts(){
  const s=state.dashboard?.summary||{};
  $('lead-new').textContent=fmt(Math.max(0,Number(s.social_contacts||0)-Number(s.qualified_social||0)));
  $('lead-engaged').textContent=fmt(s.social_conversations||0);
  $('lead-qualified').textContent=fmt(s.qualified_social||0);
  $('lead-booked').textContent='0';
  $('lead-client').textContent='0';
}

async function load(){
  try{
    const [dashboard,data,config]=await Promise.all([
      api('/api/dashboard'),
      api('/api/data'),
      api('/api/config')
    ]);
    state.dashboard=dashboard;state.data=data;state.config=config;
    renderOverview();renderContent();renderAccounts();renderLeadCounts();
    $('analytics-status').textContent=(dashboard.topPosts||[]).length?'Live':'Waiting for metrics';
    $('analytics-status').className=(dashboard.topPosts||[]).length?'ok':'pending';
  }catch(error){
    console.error(error);
    $('summary-cards').innerHTML=`<div class="notice" style="grid-column:1/-1"><div class="notice-icon">!</div><div><strong>Database setup still needs attention</strong><p>${esc(error.message)}</p></div></div>`;
  }
}

document.querySelectorAll('.nav-item').forEach(x=>x.addEventListener('click',()=>setView(x.dataset.view)));
document.querySelectorAll('[data-jump]').forEach(x=>x.addEventListener('click',()=>setView(x.dataset.jump)));
$('refresh-all').addEventListener('click',load);
$('content-platform-filter').addEventListener('change',renderContent);

load();