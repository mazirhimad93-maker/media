const media=window.__alchemic;
if(!media) throw new Error('Alchemic core unavailable');
const {state,esc,fmt,platformLabel,dateShort}=media;
const $=id=>document.getElementById(id);

const defaults=[
  ['content','Content',330,true],['platform','Platform',100,true],['account','Account',155,true],
  ['views','Views',90,true],['primary_result','Result',115,true],['link_clicks','Link Clicks',105,true],
  ['inbound_dms','DMs',90,true],['dm_threads','DM Threads',100,false],['engagement_rate','Eng. Rate',105,true],
  ['engagements','Engagements',110,false],['comments','Comments',95,true],['likes','Likes',85,false],
  ['shares','Shares',85,false],['saves','Saves',85,false],['status','Status',100,true],
  ['published_at','Published',120,false],['metrics_updated','Metrics Updated',135,false],
  ['clip','Clip',90,true],['result_url','Published URL',130,true],['error','Error',170,false]
].map(([key,label,width,visible])=>({key,label,width,visible}));

const ui={columns:null,sortKey:'finished_at',sortDir:'desc',drag:null};
const prefKey=()=>`alchemic-content-columns-v2:${state.auth?.workspace?.id||'default'}`;

function columns(){
  if(ui.columns) return ui.columns;
  let saved=null;
  try{saved=JSON.parse(localStorage.getItem(prefKey())||'null')}catch{}
  const map=new Map(defaults.map(x=>[x.key,{...x}]));
  ui.columns=[];
  for(const x of Array.isArray(saved)?saved:[]){
    if(!map.has(x.key)) continue;
    const base=map.get(x.key); map.delete(x.key);
    ui.columns.push({...base,visible:x.visible!==false,width:Math.max(70,Math.min(700,Number(x.width||base.width)))});
  }
  for(const x of map.values()) ui.columns.push(x);
  return ui.columns;
}
const visible=()=>columns().filter(x=>x.visible!==false);
const save=()=>{try{localStorage.setItem(prefKey(),JSON.stringify(columns().map(({key,visible,width})=>({key,visible,width}))))}catch{}};

const statusClass=s=>['approved','done','active'].includes(s)?'status-approved':s==='ready'?'status-ready':['running','rendering'].includes(s)?'status-running':['failed','error'].includes(s)?'status-failed':'status-other';

function sortValue(r,k){
  if(k==='content') return r.title||'';
  if(k==='platform') return platformLabel(r.platform);
  if(k==='account') return r.account_username||'';
  if(k==='status') return r.status||'';
  if(k==='published_at'||k==='finished_at') return new Date(r.finished_at||r.created_at||0).getTime();
  if(k==='metrics_updated') return new Date(r.metrics_captured_at||0).getTime();
  return Number(r[k]||0);
}

function filteredRows(){
  const p=$('content-platform-filter')?.value||'all', s=$('content-status-filter')?.value||'all';
  const c=$('content-campaign-filter')?.value||'all', d=$('content-date-filter')?.value||'all';
  const cutoff=d==='all'?null:Date.now()-Number(d)*86400000;
  const dir=ui.sortDir==='asc'?1:-1;
  return (state.content?.rows||[]).filter(r=>{
    if(p!=='all'&&r.platform!==p) return false;
    if(s!=='all'&&r.status!==s) return false;
    if(c!=='all'&&r.campaign_id!==c) return false;
    if(cutoff&&new Date(r.finished_at||r.created_at||0).getTime()<cutoff) return false;
    return true;
  }).sort((a,b)=>{
    const av=sortValue(a,ui.sortKey),bv=sortValue(b,ui.sortKey);
    return (typeof av==='number'&&typeof bv==='number'?(av-bv):String(av).localeCompare(String(bv),undefined,{numeric:true}))*dir;
  });
}

function cell(r,k){
  if(k==='content') return `<div class="content-name-cell"><strong>${esc(r.title||'Content')}</strong><span>${esc(r.campaign_name||'No campaign')}</span>${r.caption?`<small>${esc(r.caption.slice(0,150))}</small>`:''}</div>`;
  if(k==='platform') return `<span class="platform-chip">${esc(platformLabel(r.platform))}</span>`;
  if(k==='account') return esc(r.account_username||'—');
  if(k==='status') return `<span class="status-chip ${statusClass(r.status)}">${esc(r.status||'—')}</span>`;
  if(['views','likes','comments','shares','saves','engagements'].includes(k)) return r[k]===null||r[k]===undefined ? '<span class="metric-unavailable" title="Metric not available with the current platform permission">—</span>' : fmt(r[k]);
  if(['link_clicks','inbound_dms','dm_threads'].includes(k)) return fmt(r[k]||0);
  if(k==='primary_result') return `<div class="primary-result-cell"><strong>${fmt(r.primary_result||0)}</strong><span>${esc(r.primary_result_label||'Result')}</span></div>`;
  if(k==='engagement_rate') return r.engagement_rate===null||r.engagement_rate===undefined ? '<span class="metric-unavailable">—</span>' : Number(r.engagement_rate).toFixed(2)+'%';
  if(k==='published_at') return dateShort(r.finished_at||r.created_at);
  if(k==='metrics_updated') return r.metrics_captured_at?dateShort(r.metrics_captured_at):'Not synced';
  if(k==='clip') return (r.external_post_url||r.external_post_id)
    ? `<button class="open-btn content-preview" data-queue="${esc(r.queue_id)}" type="button">Preview</button>`
    : '—';
  if(k==='result_url') return r.external_post_url?`<a class="post-url" href="${esc(r.external_post_url)}" target="_blank" rel="noopener">Open post ↗</a>`:(r.external_post_id?esc(r.external_post_id):'—');
  if(k==='error') return r.error?`<span class="content-error">${esc(r.error)}</span>`:'—';
  return '—';
}

function move(from,to){
  if(!from||!to||from===to) return;
  const list=columns(),a=list.findIndex(x=>x.key===from),b=list.findIndex(x=>x.key===to);
  if(a<0||b<0) return;
  const [item]=list.splice(a,1); list.splice(b,0,item); save(); render();
}

function renderManager(){
  const host=$('content-columns-list'); if(!host) return;
  host.innerHTML=columns().map((x,i)=>`<div class="column-manager-row" draggable="true" data-column="${x.key}"><span class="column-drag-handle">⋮⋮</span><label><input class="content-column-toggle" type="checkbox" data-column="${x.key}" ${x.visible?'checked':''}><span>${esc(x.label)}</span></label><span class="column-order">${i+1}</span></div>`).join('');
  host.querySelectorAll('.content-column-toggle').forEach(el=>el.onchange=()=>{const x=columns().find(c=>c.key===el.dataset.column);x.visible=el.checked;if(!columns().some(c=>c.visible))x.visible=true;save();render()});
  host.querySelectorAll('.column-manager-row').forEach(row=>{
    row.ondragstart=()=>ui.drag=row.dataset.column; row.ondragover=e=>e.preventDefault(); row.ondrop=e=>{e.preventDefault();move(ui.drag,row.dataset.column)};
  });
}

function renderHead(){
  const host=$('content-table-head'); if(!host) return;
  host.innerHTML='<tr>'+visible().map(x=>`<th data-column="${x.key}" draggable="true" style="width:${x.width}px;min-width:${x.width}px;max-width:${x.width}px"><button class="content-sort-button" data-column="${x.key}"><span>${esc(x.label)}</span>${ui.sortKey===x.key?`<b>${ui.sortDir==='asc'?'↑':'↓'}</b>`:''}</button><span class="column-resizer" data-column="${x.key}"></span></th>`).join('')+'</tr>';
  host.querySelectorAll('.content-sort-button').forEach(b=>b.onclick=()=>{const k=b.dataset.column;if(ui.sortKey===k)ui.sortDir=ui.sortDir==='asc'?'desc':'asc';else{ui.sortKey=k;ui.sortDir=['content','platform','account','status'].includes(k)?'asc':'desc'}render()});
  host.querySelectorAll('th').forEach(th=>{th.ondragstart=e=>{if(e.target.classList.contains('column-resizer'))return e.preventDefault();ui.drag=th.dataset.column};th.ondragover=e=>e.preventDefault();th.ondrop=e=>{e.preventDefault();move(ui.drag,th.dataset.column)}});
  host.querySelectorAll('.column-resizer').forEach(h=>h.onpointerdown=e=>{e.preventDefault();e.stopPropagation();const x=columns().find(c=>c.key===h.dataset.column),sx=e.clientX,sw=x.width;const mv=ev=>{x.width=Math.max(70,Math.min(700,sw+ev.clientX-sx));applyWidths()};const up=()=>{document.removeEventListener('pointermove',mv);save()};document.addEventListener('pointermove',mv);document.addEventListener('pointerup',up,{once:true})});
}

function applyWidths(){for(const x of visible())document.querySelectorAll(`#content-performance-table [data-column="${x.key}"]`).forEach(el=>{el.style.width=x.width+'px';el.style.minWidth=x.width+'px';el.style.maxWidth=x.width+'px'})}

function badge(){
  const vals=['content-campaign-filter','content-date-filter','content-status-filter','content-platform-filter'].map(id=>$(id)?.value||'all'),n=vals.filter(x=>x!=='all').length,b=$('content-filter-count');
  if(b){b.textContent=n;b.hidden=!n}$('content-filter-button')?.classList.toggle('active-filter',n>0);
}

function render(){
  if(!$('content-table')||!state.content) return;
  const rows=filteredRows();
  const pub=rows.filter(x=>x.status==='done'||x.external_post_id||x.external_post_url);
  const views=pub.reduce((n,x)=>n+Number(x.views||0),0);
  const eng=pub.reduce((n,x)=>n+Number(x.engagements||0),0);
  const clicks=pub.reduce((n,x)=>n+Number(x.link_clicks||0),0);
  const dms=pub.reduce((n,x)=>n+Number(x.inbound_dms||0),0);
  const platform=$('content-platform-filter')?.value||'all';
  const resultLabel=platform==='youtube_shorts'?'Link Clicks':platform==='instagram_reels'||platform==='facebook_page'||platform==='tiktok_video'||platform==='tiktok'?'DMs':'Primary Results';
  const resultValue=platform==='youtube_shorts'?clicks:(platform==='all'?clicks+dms:dms);
  badge();renderManager();renderHead();
  $('content-summary').innerHTML=[
    ['Views',views,'orange','◉'],
    [resultLabel,resultValue,'purple','◆'],
    ['Published Clips',pub.length,'green','▤'],
    ['Engagements',eng,'cyan','↗']
  ].map(x=>`<div class="stat-card whop-stat-card"><div class="stat-icon ${x[2]}">${x[3]}</div><div><strong>${fmt(x[1])}</strong><span>${esc(x[0])}</span></div></div>`).join('');
  const cols=visible(); $('content-table-meta').textContent=`${rows.length} rows · ${cols.length} visible columns · drag headers to reorder`;
  $('content-table').innerHTML=rows.length?rows.map(r=>'<tr>'+cols.map(x=>`<td data-column="${x.key}" style="width:${x.width}px;min-width:${x.width}px;max-width:${x.width}px">${cell(r,x.key)}</td>`).join('')+'</tr>').join(''):`<tr><td class="empty-row" colspan="${Math.max(1,cols.length)}">No content matches the current filters.</td></tr>`;
  $('content-mobile-list').innerHTML=rows.length?rows.map(r=>`
    <article class="content-mobile-card">
      <div class="content-mobile-card-top"><span class="platform-chip">${esc(platformLabel(r.platform))}</span><span class="status-chip ${statusClass(r.status)}">${esc(r.status||'—')}</span></div>
      <h3>${esc(r.title||'Content')}</h3>
      <p>${esc(r.campaign_name||'No campaign')} · ${esc(r.account_username||'No account')}</p>
      <div class="content-mobile-metrics"><span><strong>${r.views==null?'—':fmt(r.views)}</strong> views</span><span><strong>${fmt(r.primary_result||0)}</strong> ${esc(r.primary_result_label||'results')}</span><span>${esc(dateShort(r.finished_at||r.created_at)||'')}</span></div>
      <div class="content-mobile-actions">
        <button class="open-btn content-preview" data-queue="${esc(r.queue_id)}" type="button">View details</button>
        ${r.external_post_url?`<a class="post-url" href="${esc(r.external_post_url)}" target="_blank" rel="noopener">Open post ↗</a>`:''}
      </div>
    </article>`).join(''):'<div class="empty-list">No content matches the current filters.</div>';
  document.querySelectorAll('.content-preview').forEach(button=>{
    button.onclick=()=>{
      const row=(state.content?.rows||[]).find(x=>String(x.queue_id)===String(button.dataset.queue));
      if(row) window.dispatchEvent(new CustomEvent('alchemic-open-published-post',{detail:{row}}));
    };
  });
  applyWidths();
  window.dispatchEvent(new CustomEvent('alchemic-content-rendered',{detail:{rows}}));
}

function clone(id){const n=$(id);if(!n)return;const c=n.cloneNode(true);n.replaceWith(c)}
for(const id of ['content-platform-filter','content-status-filter','content-campaign-filter','content-date-filter'])clone(id);
for(const id of ['content-platform-filter','content-status-filter','content-campaign-filter','content-date-filter'])$(id)?.addEventListener('change',render);

$('content-filter-button')?.addEventListener('click',e=>{e.stopPropagation();const f=$('content-filter-panel'),c=$('content-columns-panel');f.hidden=!f.hidden;c.hidden=true});
$('content-columns-button')?.addEventListener('click',e=>{e.stopPropagation();const f=$('content-filter-panel'),c=$('content-columns-panel');c.hidden=!c.hidden;f.hidden=true;renderManager()});
$('close-content-filters')?.addEventListener('click',()=>$('content-filter-panel').hidden=true);
$('close-content-columns')?.addEventListener('click',()=>$('content-columns-panel').hidden=true);
$('reset-content-filters')?.addEventListener('click',()=>{for(const id of ['content-platform-filter','content-status-filter','content-campaign-filter','content-date-filter'])$(id).value='all';render()});
$('reset-content-columns')?.addEventListener('click',()=>{ui.columns=defaults.map(x=>({...x}));save();render()});
document.addEventListener('click',e=>{if(!e.target.closest('.content-toolbar')){$('content-filter-panel')&&($('content-filter-panel').hidden=true);$('content-columns-panel')&&($('content-columns-panel').hidden=true)}});

const paint=setInterval(()=>{if(state.content?.rows){render();clearInterval(paint)}},300);
document.querySelector('.nav-item[data-view="content"]')?.addEventListener('click',()=>setTimeout(render,0));
document.querySelectorAll('[data-jump="content"]').forEach(n=>n.addEventListener('click',()=>setTimeout(render,0)));
document.addEventListener('click',event=>{
  if(event.target.closest('.campaign-content')) setTimeout(render,20);
});
$('refresh-all')?.addEventListener('click',()=>setTimeout(render,1200));

window.__alchemicContentTable={render,filteredRows};
