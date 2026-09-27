const $=id=>document.getElementById(id);

const TEMP_PASSWORD='alchemic2026';
const state={
  dashboard:null,
  data:null,
  config:null,
  clips:{clips:[],summary:{}},
  content:{rows:[],published:[],summary:{}},
  view:'overview'
};

const fmt=n=>Intl.NumberFormat('en',{notation:Number(n)>=10000?'compact':'standard',maximumFractionDigits:1}).format(Number(n||0));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const platformLabel=p=>({instagram_reels:'Instagram',youtube_shorts:'YouTube',tiktok_video:'TikTok',tiktok:'TikTok',facebook:'Facebook'}[p]||p||'Unknown');

async function api(path,options={}){
  const headers={...(options.headers||{})};
  if(options.body!==undefined){
    headers['content-type']='application/json';
  }
  const r=await fetch(path,{
    ...options,
    headers,
    body:options.body===undefined?undefined:JSON.stringify(options.body)
  });
  const payload=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(payload.error||`Request failed (${r.status})`);
  return payload;
}

function setView(name){
  state.view=name;
  document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===`view-${name}`));
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===name));
  const titles={
    overview:['Media Dashboard','Track content, clipping, distribution, conversations and leads from one place.'],
    clipping:['Clipping','Review every rendered clip before and after distribution.'],
    content:['Content & Distribution','See queued posts, published results and live URLs.'],
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

function statusClass(status){
  if(status==='approved'||status==='done') return 'status-approved';
  if(status==='ready') return 'status-ready';
  if(status==='running'||status==='rendering') return 'status-running';
  if(status==='failed'||status==='error') return 'status-failed';
  return 'status-other';
}

function renderOverview(){
  const d=state.dashboard||{};
  const clips=state.clips||{clips:[],summary:{}};
  const content=state.content||{published:[],summary:{}};
  const accounts=state.data?.accounts||[];
  const published=content.published||[];
  const s=d.summary||{};

  const totalViews=published.reduce((n,x)=>n+Number(x.views||0),0);
  const engagements=published.reduce((n,x)=>n+Number(x.likes||0)+Number(x.comments||0)+Number(x.shares||0)+Number(x.saves||0),0);

  $('summary-cards').innerHTML=[
    stat('Rendered Clips',clips.summary?.total||0,'blue','✂'),
    stat('Published Posts',content.summary?.published||0,'green','▶'),
    stat('Total Views',totalViews,'orange','↗'),
    stat('Conversations',s.social_conversations||0,'purple','✉'),
    stat('Content Leads',s.content_leads||0,'cyan','◉')
  ].join('');

  $('clip-pending-badge').textContent=fmt(clips.summary?.needs_approval||0);
  $('unread-pill').textContent=fmt(s.social_unread||0);
  $('email-bridge').textContent=d.outreachBridge?'Connected, read only':'Not configured';
  $('email-bridge').className=d.outreachBridge?'ok':'pending';

  const byPlatform={};
  for(const row of published){
    const p=row.platform||'unknown';
    byPlatform[p] ||= {platform:p,posts:0,views:0};
    byPlatform[p].posts++;
    byPlatform[p].views+=Number(row.views||0);
  }
  const platforms=Object.values(byPlatform);
  const maxViews=Math.max(1,...platforms.map(x=>x.views));
  $('platform-bars').innerHTML=platforms.length?platforms.map(x=>`
    <div class="platform-row">
      <div class="platform-name">${esc(platformLabel(x.platform))}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2,Math.round(x.views/maxViews*100))}%"></div></div>
      <div class="bar-stat"><strong>${fmt(x.posts)}</strong><span>posts</span></div>
      <div class="bar-stat"><strong>${fmt(x.views)}</strong><span>views</span></div>
    </div>`).join(''):'<div class="empty-row">Published posts will appear here as soon as the Distributor has completed queue rows.</div>';

  $('media-pipeline').innerHTML=[
    ['Rendered clips',clips.summary?.total||0],
    ['Approved clips',clips.summary?.approved||0],
    ['Queued clips',clips.summary?.queued||0],
    ['Published clips',clips.summary?.published||0]
  ].map((x,i)=>`${i?'<div class="pipeline-arrow">↓</div>':''}<div class="pipeline-step"><span>${x[0]}</span><strong>${fmt(x[1])}</strong></div>`).join('');

  $('recent-published').innerHTML=published.length?published.slice(0,12).map(x=>`
    <tr>
      <td><strong>${esc(x.title||'Published clip')}</strong></td>
      <td><span class="platform-chip">${esc(platformLabel(x.platform))}</span></td>
      <td>${esc(x.account_username||'—')}</td>
      <td><span class="status-chip ${statusClass(x.status)}">${esc(x.status||'—')}</span></td>
      <td>${fmt(x.views)}</td>
      <td>${x.external_post_url?`<a class="post-url" href="${esc(x.external_post_url)}" target="_blank" rel="noopener">Open post ↗</a>`:(x.external_post_id?esc(x.external_post_id):'—')}</td>
    </tr>`).join(''):'<tr><td class="empty-row" colspan="6">No published queue rows found yet.</td></tr>';

  $('recent-clips').innerHTML=(clips.clips||[]).length?clips.clips.slice(0,8).map(x=>`
    <div class="clip-mini">
      <div class="clip-mini-main">
        <strong>${esc(x.title||'Clip')}</strong>
        <span>${esc(x.campaign_name||'No campaign')} · ${esc(x.status||'unknown')} · ${x.duration_seconds?Math.round(Number(x.duration_seconds))+' sec':'duration unknown'}</span>
      </div>
      <div class="clip-actions">
        ${x.render_url?`<a class="open-btn" href="${esc(x.render_url)}" target="_blank" rel="noopener">Open clip ↗</a>`:''}
      </div>
    </div>`).join(''):'<div class="empty-row">No clips found in the Clipper tables yet.</div>';

  $('queue-status').textContent=(content.summary?.total_queue||0)>0?`${fmt(content.summary.total_queue)} jobs`:'Connected';
}

function clipFilterRows(){
  const filter=$('clip-status-filter')?.value||'all';
  return (state.clips?.clips||[]).filter(x=>{
    if(filter==='all') return true;
    if(filter==='needs') return x.status!=='approved'&&x.status!=='done';
    if(filter==='approved') return x.status==='approved'||x.asset?.status==='approved';
    if(filter==='published') return x.published_count>0;
    return true;
  });
}

function renderClips(){
  const s=state.clips?.summary||{};
  $('clip-summary').innerHTML=[
    stat('Total Clips',s.total||0,'blue','✂'),
    stat('Needs Approval',s.needs_approval||0,'orange','!'),
    stat('Approved',s.approved||0,'green','✓'),
    stat('Queued',s.queued||0,'purple','▶'),
    stat('Published',s.published||0,'cyan','↗')
  ].join('');

  const rows=clipFilterRows();
  $('clips-table').innerHTML=rows.length?rows.map(x=>{
    const urls=(x.published_urls||[]).map(u=>u.url?`<a class="post-url" href="${esc(u.url)}" target="_blank" rel="noopener">${esc(platformLabel(u.platform))} ↗</a>`:`<span>${esc(platformLabel(u.platform))}: ${esc(u.id||'published')}</span>`).join('');
    const canApprove=!String(x.id).startsWith('asset:')&&x.status!=='approved';
    return `<tr>
      <td>
        <strong>${esc(x.title||'Clip')}</strong>
        ${x.hook?`<div class="hook-text">${esc(x.hook)}</div>`:''}
      </td>
      <td>${esc(x.campaign_name||'—')}</td>
      <td>${x.duration_seconds?Math.round(Number(x.duration_seconds))+'s':'—'}</td>
      <td><span class="status-chip ${statusClass(x.status)}">${esc(x.status||'unknown')}</span></td>
      <td>${x.render_url?`<a class="open-btn" href="${esc(x.render_url)}" target="_blank" rel="noopener">View video ↗</a>`:'—'}</td>
      <td><div class="queue-pills"><span class="queue-pill">${fmt(x.queue_count)} total</span><span class="queue-pill">${fmt(x.pending_count)} pending</span></div></td>
      <td><div class="url-stack">${urls||'<span>—</span>'}</div></td>
      <td>${canApprove?`<button class="action-btn approve-clip" data-id="${esc(x.id)}">Approve</button>`:'<span class="ok">Approved</span>'}</td>
    </tr>`;
  }).join(''):'<tr><td class="empty-row" colspan="8">No clips match this filter.</td></tr>';

  document.querySelectorAll('.approve-clip').forEach(btn=>btn.addEventListener('click',()=>approveClip(btn)));
}

async function approveClip(btn){
  const id=btn.dataset.id;
  btn.disabled=true;
  btn.textContent='Approving…';
  try{
    await api('/api/clips/action',{
      method:'POST',
      headers:{'x-media-password':TEMP_PASSWORD},
      body:{id,action:'approve'}
    });
    await loadClips();
    renderOverview();
  }catch(error){
    alert(error.message);
  }finally{
    btn.disabled=false;
    btn.textContent='Approve';
  }
}

function contentFilterRows(){
  const platform=$('content-platform-filter')?.value||'all';
  const status=$('content-status-filter')?.value||'all';
  return (state.content?.rows||[]).filter(x=>(platform==='all'||x.platform===platform)&&(status==='all'||x.status===status));
}

function renderContent(){
  const rows=contentFilterRows();
  $('content-summary').innerHTML=[
    stat('Queue Jobs',state.content?.summary?.total_queue||0,'blue','▶'),
    stat('Published',state.content?.summary?.published||0,'green','✓'),
    stat('Ready',state.content?.summary?.ready||0,'orange','•'),
    stat('Running',state.content?.summary?.running||0,'purple','↻'),
    stat('Views',state.content?.summary?.views||0,'cyan','↗')
  ].join('');

  $('content-table').innerHTML=rows.length?rows.map(x=>`
    <tr>
      <td>
        <strong>${esc(x.title||'Content')}</strong>
        ${x.caption?`<div class="hook-text">${esc(x.caption.slice(0,140))}</div>`:''}
      </td>
      <td><span class="platform-chip">${esc(platformLabel(x.platform))}</span></td>
      <td>${esc(x.account_username||'—')}</td>
      <td><span class="status-chip ${statusClass(x.status)}">${esc(x.status||'—')}</span></td>
      <td>${fmt(x.views)}</td>
      <td>${fmt(x.comments)}</td>
      <td>${x.source_url?`<a class="open-btn" href="${esc(x.source_url)}" target="_blank" rel="noopener">Clip ↗</a>`:'—'}</td>
      <td>${x.external_post_url?`<a class="post-url" href="${esc(x.external_post_url)}" target="_blank" rel="noopener">Published post ↗</a>`:(x.external_post_id?esc(x.external_post_id):'—')}</td>
      <td>${x.error?`<span style="color:#b91c1c">${esc(x.error)}</span>`:'—'}</td>
    </tr>`).join(''):'<tr><td class="empty-row" colspan="9">No queue rows match this filter.</td></tr>';
}

function renderAccounts(){
  const data=state.data||{accounts:[]},config=state.config||{providers:{}};
  const accounts=data.accounts||[];
  $('account-count').textContent=`${accounts.length} channels`;
  $('ig-provider-status').textContent=config.providers?.instagram?.ready?'Connector configured':'Publishing connected · add messaging OAuth';
  $('yt-provider-status').textContent=config.providers?.youtube?.ready?'Connector configured':'Existing channel tokens in DB';

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

async function loadClips(){
  state.clips=await api('/api/clips');
  renderClips();
}

async function loadContent(){
  state.content=await api('/api/content');
  renderContent();
}

async function load(){
  try{
    const [dashboard,data,config,clips,content]=await Promise.all([
      api('/api/dashboard'),
      api('/api/data'),
      api('/api/config'),
      api('/api/clips'),
      api('/api/content')
    ]);
    state.dashboard=dashboard;
    state.data=data;
    state.config=config;
    state.clips=clips;
    state.content=content;
    renderOverview();
    renderClips();
    renderContent();
    renderAccounts();
    renderLeadCounts();
  }catch(error){
    console.error(error);
    $('summary-cards').innerHTML=`<div class="notice" style="grid-column:1/-1"><div class="notice-icon">!</div><div><strong>Database setup still needs attention</strong><p>${esc(error.message)}</p></div></div>`;
  }
}

function unlock(){
  $('temp-lock').hidden=true;
  $('app-shell').hidden=false;
  sessionStorage.setItem('alchemic_media_unlocked','1');
  load();
}

$('temp-lock-form').addEventListener('submit',e=>{
  e.preventDefault();
  const value=$('temp-password').value;
  if(value!==TEMP_PASSWORD){
    $('temp-lock-error').textContent='Wrong password';
    return;
  }
  $('temp-lock-error').textContent='';
  unlock();
});

document.querySelectorAll('.nav-item').forEach(x=>x.addEventListener('click',()=>setView(x.dataset.view)));
document.querySelectorAll('[data-jump]').forEach(x=>x.addEventListener('click',()=>setView(x.dataset.jump)));
$('refresh-all').addEventListener('click',load);
$('content-platform-filter').addEventListener('change',renderContent);
$('content-status-filter').addEventListener('change',renderContent);
$('clip-status-filter').addEventListener('change',renderClips);
$('sync-metrics').addEventListener('click',async()=>{
  const btn=$('sync-metrics');
  btn.disabled=true;
  btn.textContent='Syncing…';
  try{
    await api('/api/metrics/sync',{
      method:'POST',
      headers:{'x-media-password':TEMP_PASSWORD},
      body:{limit:100}
    });
    await loadContent();
    renderOverview();
  }catch(error){
    alert(error.message);
  }finally{
    btn.disabled=false;
    btn.textContent='Sync metrics';
  }
});

if(sessionStorage.getItem('alchemic_media_unlocked')==='1') unlock();
