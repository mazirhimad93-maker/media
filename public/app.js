const $=id=>document.getElementById(id);

const WRITE_KEY='alchemic2026';

const state={
  dashboard:null,
  data:null,
  config:null,
  campaigns:{campaigns:[],summary:{}},
  clips:{clips:[],summary:{}},
  content:{rows:[],published:[],summary:{}},
  jobs:{jobs:[],campaign_progress:[],summary:{}},
  presets:{presets:[]},
  settings:null,
  auth:{accessToken:null,user:null,profile:null,workspace:null},
  inbox:{social:[],selected:null,conversation:null},
  selectedClips:new Set(),
  expandedClipJobs:new Set(),
  view:'overview'
};

const fmt=n=>Intl.NumberFormat('en',{
  notation:Number(n)>=10000?'compact':'standard',
  maximumFractionDigits:1
}).format(Number(n||0));

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

const platformLabel=p=>({
  instagram_reels:'Instagram',
  facebook_page:'Facebook',
  youtube_shorts:'YouTube',
  tiktok_video:'TikTok',
  tiktok:'TikTok',
  facebook:'Facebook'
}[p]||p||'Unknown');

const dateShort=v=>{
  if(!v) return '—';
  const d=new Date(v);
  if(Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
};

async function restoreSession(){
  try{
    const response=await fetch('/api/auth/session',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'}});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||!payload.authenticated||!payload.access_token) return false;
    state.auth.accessToken=payload.access_token;
    state.auth.user=payload.user||null;
    state.auth.profile=payload.profile||null;
    state.auth.workspace=payload.workspace||null;
    return true;
  }catch{return false;}
}

async function api(path,options={}){
  const internal={...options};
  const retried=Boolean(internal.__retried);
  delete internal.__retried;
  const headers={...(internal.headers||{})};
  if(internal.body!==undefined) headers['content-type']='application/json';
  if(state.auth?.accessToken && !headers.authorization) headers.authorization=`Bearer ${state.auth.accessToken}`;

  const response=await fetch(path,{
    ...internal,
    credentials:'same-origin',
    headers,
    body:internal.body===undefined?undefined:JSON.stringify(internal.body)
  });

  const payload=await response.json().catch(()=>({}));
  if(response.status===401 && !retried && !path.startsWith('/api/auth/')){
    const restored=await restoreSession();
    if(restored) return api(path,{...options,__retried:true});
    if(window.showAlchemicAuth) window.showAlchemicAuth('Your session expired. Sign in again.');
  }
  if(!response.ok) throw new Error(payload.error||`Request failed (${response.status})`);
  return payload;
}

function statusClass(status){
  if(status==='approved'||status==='done'||status==='active') return 'status-approved';
  if(status==='ready') return 'status-ready';
  if(status==='running'||status==='rendering') return 'status-running';
  if(status==='failed'||status==='error') return 'status-failed';
  return 'status-other';
}

function stat(label,value,tone,icon){
  return `
    <div class="stat-card">
      <div class="stat-icon ${tone}">${icon}</div>
      <div><strong>${fmt(value)}</strong><span>${esc(label)}</span></div>
    </div>
  `;
}

function setView(name){
  state.view=name;

  document.querySelectorAll('.view').forEach(el=>{
    el.classList.toggle('active',el.id===`view-${name}`);
  });

  document.querySelectorAll('.nav-item').forEach(el=>{
    el.classList.toggle('active',el.dataset.view===name);
  });

  const titles={
    overview:['Media Dashboard','Track content, clipping, distribution, conversations and leads from one place.'],
    clipping:['Clipping','Review clips and approve the ones ready to publish.'],
    campaigns:['Campaigns','See each media campaign from clip production through published results.'],
    content:['Content & Distribution','See queued posts, published results, live URLs and platform performance.'],
    inbox:['Unified Inbox','Your connected conversations in one place.'],
    leads:['Lead Pipeline','Track content-generated leads from first engagement to client.'],
    accounts:['Connected Channels','Manage publishing capacity, messaging access and connected channels.'],
    settings:['Settings','Manage your account, workspace and security.']
  };

  $('view-title').textContent=titles[name]?.[0]||'Alchemic Media';
  $('view-subtitle').textContent=titles[name]?.[1]||'';

  if(name==='settings') renderSettings();
  if(name==='leads') window.loadAlchemicLeads?.();
}

function allCampaigns(){
  const fromCampaignApi=state.campaigns?.campaigns||[];
  if(fromCampaignApi.length) return fromCampaignApi;

  const map=new Map();
  for(const c of state.clips?.campaigns||[]) map.set(c.id,c);
  for(const c of state.content?.campaigns||[]) map.set(c.id,c);
  return [...map.values()];
}

function campaignMemberIds(campaignOrId){
  const campaign=typeof campaignOrId==='string'
    ? (state.campaigns?.campaigns||[]).find(c=>c.id===campaignOrId)
    : campaignOrId;
  const ids=campaign?.member_campaign_ids;
  return new Set(Array.isArray(ids)&&ids.length?ids:[campaign?.id||campaignOrId].filter(Boolean));
}

function campaignGroupForMemberId(memberId){
  return (state.campaigns?.campaigns||[]).find(c=>campaignMemberIds(c).has(memberId))||null;
}

function campaignGroupKey(value){
  const hay=[value?.group_key,value?.slug,value?.campaign_slug,value?.name,value?.campaign_name]
    .filter(Boolean).join(' ').toLowerCase();
  if(/(^|\b)(alchemic|alchemix)(\b|$)/.test(hay)) return 'alchemic';
  if(/(^|\b)(zach|zack)(\b|$)/.test(hay)) return 'zach';
  return 'whoop';
}

function jobBelongsToCampaignGroup(job,campaignOrId){
  const campaign=typeof campaignOrId==='string'
    ? (state.campaigns?.campaigns||[]).find(c=>c.id===campaignOrId)
    : campaignOrId;
  if(!campaign) return false;
  if(campaignMemberIds(campaign).has(job.campaign_id)) return true;
  return campaignGroupKey(job)===campaignGroupKey(campaign);
}

function populateCampaignFilters(){
  const campaigns=allCampaigns();
  const options=campaigns
    .slice()
    .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')))
    .map(c=>`<option value="${esc(c.id)}">${esc(c.name||'Untitled campaign')}</option>`)
    .join('');

  for(const id of ['clip-campaign-filter','content-campaign-filter']){
    const select=$(id);
    if(!select) continue;
    const current=select.value||'all';
    select.innerHTML=`<option value="all">All campaigns</option>${options}`;
    if([...select.options].some(o=>o.value===current)) select.value=current;
  }
}

function contentRowsForClip(clip){
  const assetId=clip.asset?.id||null;
  return (state.content?.rows||[]).filter(row=>{
    if(assetId && row.asset_id===assetId) return true;
    if(!String(clip.id).startsWith('asset:') && row.clip_variant_id===clip.id) return true;
    return false;
  });
}

function clipPerformance(clip){
  const rows=contentRowsForClip(clip);
  return rows.reduce((out,row)=>{
    out.views+=Number(row.views||0);
    out.likes+=Number(row.likes||0);
    out.comments+=Number(row.comments||0);
    out.shares+=Number(row.shares||0);
    out.saves+=Number(row.saves||0);
    return out;
  },{views:0,likes:0,comments:0,shares:0,saves:0});
}

function renderOverview(){
  const dashboard=state.dashboard||{};
  const clips=state.clips||{clips:[],summary:{}};
  const content=state.content||{published:[],summary:{}};
  const published=content.published||[];
  const s=dashboard.summary||{};

  const totalViews=published.reduce((n,x)=>n+Number(x.views||0),0);

  $('summary-cards').innerHTML=[
    stat('Rendered Clips',clips.summary?.total||0,'blue','✂'),
    stat('Published Posts',content.summary?.published||0,'green','▶'),
    stat('Total Views',totalViews,'orange','↗'),
    stat('Conversations',s.social_conversations||0,'purple','✉'),
    stat('Content Leads',s.content_leads||0,'cyan','◉')
  ].join('');

  $('clip-pending-badge').textContent=fmt(clips.summary?.needs_approval||0);
  $('unread-pill').textContent=fmt(s.social_unread||0);


  const byPlatform={};
  for(const row of published){
    const key=row.platform||'unknown';
    byPlatform[key] ||= {platform:key,posts:0,views:0};
    byPlatform[key].posts++;
    byPlatform[key].views+=Number(row.views||0);
  }

  const platforms=Object.values(byPlatform);
  const maxViews=Math.max(1,...platforms.map(x=>x.views));

  $('platform-bars').innerHTML=platforms.length
    ? platforms.map(x=>`
      <div class="platform-row">
        <div class="platform-name">${esc(platformLabel(x.platform))}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2,Math.round(x.views/maxViews*100))}%"></div></div>
        <div class="bar-stat"><strong>${fmt(x.posts)}</strong><span>posts</span></div>
        <div class="bar-stat"><strong>${fmt(x.views)}</strong><span>views</span></div>
      </div>
    `).join('')
    : '<div class="empty-row">Published posts are connected. Use Sync metrics to populate platform views.</div>';

  $('media-pipeline').innerHTML=[
    ['Rendered clips',clips.summary?.total||0],
    ['Approved clips',clips.summary?.approved||0],
    ['Queued clips',clips.summary?.queued||0],
    ['Published clips',clips.summary?.published||0]
  ].map((x,i)=>`
    ${i?'<div class="pipeline-arrow">↓</div>':''}
    <div class="pipeline-step"><span>${x[0]}</span><strong>${fmt(x[1])}</strong></div>
  `).join('');

  $('recent-published').innerHTML=published.length
    ? published.slice(0,12).map(x=>`
      <tr>
        <td><strong>${esc(x.title||'Published clip')}</strong></td>
        <td><span class="platform-chip">${esc(platformLabel(x.platform))}</span></td>
        <td>${esc(x.account_username||'—')}</td>
        <td><span class="status-chip ${statusClass(x.status)}">${esc(x.status||'—')}</span></td>
        <td>${fmt(x.views)}</td>
        <td>${x.external_post_url
          ? `<a class="post-url" href="${esc(x.external_post_url)}" target="_blank" rel="noopener">Open post ↗</a>`
          : (x.external_post_id?esc(x.external_post_id):'—')}</td>
      </tr>
    `).join('')
    : '<tr><td class="empty-row" colspan="6">No published queue rows found.</td></tr>';

  $('recent-clips').innerHTML=(clips.clips||[]).length
    ? clips.clips.slice(0,8).map(x=>`
      <div class="clip-mini">
        <div class="clip-mini-main">
          <strong>${esc(x.title||'Clip')}</strong>
          <span>${esc(x.campaign_name||'No campaign')} · ${esc(x.status||'unknown')} · ${x.duration_seconds?Math.round(Number(x.duration_seconds))+' sec':'duration unknown'}</span>
        </div>
        <div class="clip-actions">
          ${x.render_url?`<button class="open-btn preview-clip" data-id="${esc(x.id)}">Preview</button>`:''}
          <button class="details-btn clip-details" data-id="${esc(x.id)}">Details</button>
        </div>
      </div>
    `).join('')
    : '<div class="empty-row">No clips found in the Clipper tables yet.</div>';

  $('queue-status').textContent=(content.summary?.total_queue||0)>0
    ? `${fmt(content.summary.total_queue)} jobs`
    : 'Connected';

  bindClipButtons();
}

function clipFilterRows(){
  const status=$('clip-status-filter')?.value||'all';
  const campaign=$('clip-campaign-filter')?.value||'all';
  const platform=$('clip-platform-filter')?.value||'all';
  const dateWindow=$('clip-date-filter')?.value||'all';
  const search=($('clip-search')?.value||'').trim().toLowerCase();
  const cutoff=dateWindow==='all'?null:(Date.now()-Number(dateWindow)*86400000);

  return (state.clips?.clips||[]).filter(clip=>{
    if(status==='needs' && clip.publishing_approved!==false) return false;
    if(status==='approved' && clip.publishing_approved!==true) return false;
    if(status==='published' && !(clip.published_count>0)) return false;
    if(campaign!=='all' && !campaignMemberIds(campaign).has(clip.campaign_id)) return false;
    if(platform!=='all' && !(clip.distributions||[]).some(d=>d.platform===platform)) return false;
    if(cutoff && new Date(clip.created_at||0).getTime()<cutoff) return false;

    if(search){
      const hay=[
        clip.title,
        clip.hook,
        clip.campaign_name,
        clip.status,
        ...(clip.distributions||[]).map(x=>x.account_username),
        ...(clip.distributions||[]).map(x=>x.platform)
      ].filter(Boolean).join(' ').toLowerCase();

      if(!hay.includes(search)) return false;
    }

    return true;
  }).sort((a,b)=>{
    if(a.publishing_approved!==b.publishing_approved){
      return a.publishing_approved===false?-1:1;
    }
    return new Date(b.created_at||0)-new Date(a.created_at||0);
  });
}


function clipProgressJobs(){
  const campaignId=$('clip-campaign-filter')?.value||'all';
  const campaign=campaignId==='all'
    ? null
    : (state.campaigns?.campaigns||[]).find(c=>c.id===campaignId)||null;
  return (state.jobs?.jobs||[])
    .filter(job=>!campaign || jobBelongsToCampaignGroup(job,campaign))
    .filter(job=>!['complete'].includes(job.stage))
    .sort((x,y)=>new Date(y.updated_at||0)-new Date(x.updated_at||0));
}

function campaignForJob(job){
  return campaignGroupForMemberId(job.campaign_id)
    || (state.campaigns?.campaigns||[]).find(c=>campaignGroupKey(c)===campaignGroupKey(job))
    || null;
}

function clipReadyForPublishingApproval(clip){
  const status=String(clip.status||'').toLowerCase();
  return clip.publishing_approved===false
    && Boolean(clip.render_url)
    && ['approved','ready','done','complete','rendered'].includes(status);
}

function clipTableRow(clip,{nested=false}={}){
  const performance=clipPerformance(clip);
  const canApprove=clipReadyForPublishingApproval(clip);
  const checked=state.selectedClips.has(clip.id);
  const hasPreview=Boolean(clip.render_url||clip.render_status_url||clip.source_preview_url);
  const approvalLabel=clip.publishing_approved===true
    ? 'Approved for publishing'
    : canApprove
      ? 'Ready for approval'
      : 'Waiting for final render';

  return `
    <tr class="${nested?'job-clip-row':''}">
      <td><input class="row-check clip-check" type="checkbox" data-id="${esc(clip.id)}" ${checked?'checked':''} ${canApprove?'':'disabled'}></td>
      <td>
        <div class="${nested?'job-clip-indent':''}">
          <strong>${esc(clip.title||'Clip')}</strong>
          ${clip.hook?`<div class="hook-text">${esc(clip.hook)}</div>`:''}
        </div>
      </td>
      <td>${esc(clip.campaign_name||'—')}</td>
      <td>
        <span class="status-chip ${statusClass(clip.status)}">${esc(clip.status||'unknown')}</span>
        <div class="hook-text">${esc(approvalLabel)}</div>
      </td>
      <td>
        <div class="metric-stack">
          <strong>${fmt(performance.views)} views</strong>
          ${clip.duration_seconds?`<span>${Math.round(Number(clip.duration_seconds))} sec</span>`:''}
        </div>
      </td>
      <td>
        <div class="clip-actions">
          ${hasPreview?`<button class="open-btn preview-clip" data-id="${esc(clip.id)}">Preview</button>`:''}
          <button class="details-btn clip-details" data-id="${esc(clip.id)}">Details</button>
          ${canApprove?`<button class="action-btn approve-clip" data-id="${esc(clip.id)}">Approve for publishing</button>`:clip.publishing_approved===true?'<span class="ok">Approved</span>':''}
        </div>
      </td>
    </tr>
  `;
}

function clipJobProgressBlock(job,visibleClipIds){
  const campaign=campaignForJob(job);
  const expected=Math.max(Number(job.expected_clips||0),Number(job.variants?.total||0));
  const produced=Number(job.variants?.total||0);
  const ready=Number(job.variants?.approved||0);
  const failed=Number(job.variants?.failed||0);
  const progress=Math.max(0,Math.min(100,Number(job.progress||0)));
  const stage=job.stage_label||job.stage||'Processing';
  const eta=job.waiting
    ? 'Waiting for selection'
    : job.error
      ? (job.error_message||'Needs attention')
      : (Number.isFinite(job.eta_minutes)&&job.eta_minutes>0
          ? `≈ ${Math.max(1,Math.round(job.eta_minutes))} min left`
          : 'Working…');

  const jobIds=new Set((job.clips||[]).map(x=>String(x.id)));
  const allClips=(state.clips?.clips||[]).filter(x=>jobIds.has(String(x.id)));
  const shownClips=allClips.filter(x=>!visibleClipIds||visibleClipIds.has(String(x.id)));
  const expanded=state.expandedClipJobs.has(job.source_id);
  const latest=allClips
    .filter(x=>x.render_url)
    .sort((a,b)=>new Date(b.updated_at||b.created_at||0)-new Date(a.updated_at||a.created_at||0))[0]||null;

  const header=`
    <tr class="clip-job-group-row">
      <td></td>
      <td>
        <div class="clip-job-title-line">
          <div>
            <strong>${esc(job.title||'Source video')}</strong>
            <div class="hook-text">${produced}${expected?'/'+expected:''} clips · ${ready} rendered${failed?' · '+failed+' failed':''}</div>
          </div>
          <button class="open-btn job-toggle" data-source-id="${esc(job.source_id)}">${expanded?'Hide clips':'View '+produced+' clips'} ${expanded?'▴':'▾'}</button>
        </div>
        <div class="job-progress-track" style="margin-top:8px;max-width:520px">
          <div class="job-progress-fill" style="width:${progress}%"></div>
        </div>
        <div class="hook-text" style="margin-top:5px">${Math.round(progress)}% · ${esc(eta)}</div>
      </td>
      <td>${esc(campaign?.name||job.campaign_name||'—')}</td>
      <td>
        <span class="status-chip ${job.error?'status-failed':job.stage==='rendering'?'status-running':'status-ready'}">${esc(stage)}</span>
        <div class="hook-text">Source: ${esc(job.source_status||'—')}</div>
      </td>
      <td>
        <strong>${ready}/${produced||expected||0}</strong>
        <div class="hook-text">renders ready</div>
      </td>
      <td>
        <div class="clip-actions">
          ${latest?`<button class="action-btn preview-clip" data-id="${esc(latest.id)}">Preview latest</button>`:''}
          <button class="open-btn job-toggle" data-source-id="${esc(job.source_id)}">${expanded?'Collapse':'Open clips'}</button>
        </div>
      </td>
    </tr>
  `;

  if(!expanded) return header;

  const children=shownClips.length
    ? shownClips.map(clip=>clipTableRow(clip,{nested:true})).join('')
    : `<tr class="job-clip-row"><td></td><td colspan="5" class="empty-row">No clips in this job match the current filters.</td></tr>`;

  return header+`
    <tr class="job-clip-section-label"><td></td><td colspan="5">Clips from this source</td></tr>
  `+children;
}

function publishedDropdown(clip){
  const urls=clip.published_urls||[];
  if(!urls.length) return '—';

  return `
    <details class="url-dropdown">
      <summary>${urls.length} published ${urls.length===1?'post':'posts'} ▾</summary>
      <div class="url-menu">
        ${urls.map(u=>u.url
          ? `<a href="${esc(u.url)}" target="_blank" rel="noopener">${esc(platformLabel(u.platform))} · ${esc(u.account_username||'account')} ↗</a>`
          : `<span class="hook-text">${esc(platformLabel(u.platform))}: ${esc(u.id||'published')}</span>`
        ).join('')}
      </div>
    </details>
  `;
}

function distributionMarkup(clip){
  const rows=clip.distributions||[];
  if(!rows.length) return '<span class="hook-text">Not queued</span>';

  return `
    <div class="distribution-list">
      ${rows.slice(0,5).map(d=>`
        <div class="distribution-line">
          <span class="tiny-dot ${esc(d.status||'')}"></span>
          <b>${esc(platformLabel(d.platform))}</b>
          <span>${esc(d.account_username||'unassigned')}</span>
        </div>
      `).join('')}
      ${rows.length>5?`<span class="hook-text">+${rows.length-5} more jobs</span>`:''}
    </div>
  `;
}

function renderClips(){
  const s=state.clips?.summary||{};

  $('clip-summary').innerHTML=[
    stat('Needs Approval',s.needs_approval||0,'orange','!'),
    stat('Approved',s.approved||0,'green','✓'),
    stat('Published',s.published||0,'cyan','↗')
  ].join('');

  const rows=clipFilterRows();
  const visibleClipIds=new Set(rows.map(x=>String(x.id)));
  const progressJobs=clipProgressJobs();
  const activeJobClipIds=new Set(progressJobs.flatMap(job=>(job.clips||[]).map(x=>String(x.id))));
  const libraryRows=rows.filter(clip=>!activeJobClipIds.has(String(clip.id)));

  const sections=[];

  if(progressJobs.length){
    sections.push(`<tr class="clip-table-section"><td colspan="6"><strong>Active clipping jobs</strong><span>Open a source to review each queued, rendering or completed clip.</span></td></tr>`);
    sections.push(...progressJobs.map(job=>clipJobProgressBlock(job,visibleClipIds)));
  }

  if(libraryRows.length){
    sections.push(`<tr class="clip-table-section"><td colspan="6"><strong>Clip library</strong><span>Completed and standalone clips ready for review or publishing.</span></td></tr>`);
    sections.push(...libraryRows.map(clip=>clipTableRow(clip)));
  }

  $('clips-table').innerHTML=sections.length
    ? sections.join('')
    : '<tr><td class="empty-row" colspan="6">No clips or active clipping jobs match the current filters.</td></tr>';

  bindClipButtons();
  updateBulkBar();

  const selectAll=$('select-visible-clips');
  if(selectAll){
    const eligible=rows.filter(clipReadyForPublishingApproval);
    selectAll.checked=eligible.length>0 && eligible.every(x=>state.selectedClips.has(x.id));
    selectAll.indeterminate=eligible.some(x=>state.selectedClips.has(x.id)) && !selectAll.checked;
  }
}

function bindClipButtons(){
  document.querySelectorAll('.job-toggle').forEach(btn=>{
    btn.onclick=()=>{
      const sourceId=btn.dataset.sourceId;
      if(state.expandedClipJobs.has(sourceId)) state.expandedClipJobs.delete(sourceId);
      else state.expandedClipJobs.add(sourceId);
      renderClips();
    };
  });

  document.querySelectorAll('.approve-clip').forEach(btn=>{
    btn.onclick=()=>approveClip(btn.dataset.id,btn);
  });

  document.querySelectorAll('.preview-clip').forEach(btn=>{
    btn.onclick=()=>openVideoModal(btn.dataset.id);
  });

  document.querySelectorAll('.clip-details').forEach(btn=>{
    btn.onclick=()=>openClipDrawer(btn.dataset.id);
  });

  document.querySelectorAll('.clip-check').forEach(input=>{
    input.onchange=()=>{
      const id=input.dataset.id;
      if(input.checked) state.selectedClips.add(id);
      else state.selectedClips.delete(id);
      updateBulkBar();
      const visible=clipFilterRows().filter(x=>x.publishing_approved===false);
      const selectAll=$('select-visible-clips');
      if(selectAll){
        selectAll.checked=visible.length>0 && visible.every(x=>state.selectedClips.has(x.id));
        selectAll.indeterminate=visible.some(x=>state.selectedClips.has(x.id)) && !selectAll.checked;
      }
    };
  });
}

function updateBulkBar(){
  const count=state.selectedClips.size;
  $('bulk-bar').hidden=count===0;
  $('bulk-count').textContent=`${count} selected`;
}

async function approveClip(id,btn){
  if(btn){
    btn.disabled=true;
    btn.textContent='Approving…';
  }

  try{
    await api('/api/clips/action',{
      method:'POST',
      headers:{'x-media-password':WRITE_KEY},
      body:{id,action:'approve'}
    });

    state.selectedClips.delete(id);
    await refreshMediaData();
  }catch(error){
    alert(error.message);
  }finally{
    if(btn){
      btn.disabled=false;
      btn.textContent='Approve';
    }
  }
}

async function bulkApprove(){
  const ids=[...state.selectedClips];
  if(!ids.length) return;

  const btn=$('bulk-approve');
  btn.disabled=true;
  btn.textContent='Approving…';

  try{
    const result=await api('/api/clips/action',{
      method:'POST',
      headers:{'x-media-password':WRITE_KEY},
      body:{ids,action:'approve'}
    });

    const failed=new Set((result.results||[]).filter(x=>x.ok===false).map(x=>x.id));
    state.selectedClips=new Set(ids.filter(id=>failed.has(id)));

    await refreshMediaData();

    if(result.failed) alert(`${result.approved} approved, ${result.failed} failed.`);
  }catch(error){
    alert(error.message);
  }finally{
    btn.disabled=false;
    btn.textContent='Approve selected';
  }
}

function findClip(id){
  return (state.clips?.clips||[]).find(x=>x.id===id)||null;
}

function openVideoModal(id){
  const clip=findClip(id);
  if(!clip||!clip.render_url) return;

  $('video-modal-title').textContent=clip.title||'Clip Preview';
  $('video-modal-subtitle').textContent=clip.campaign_name||'No campaign';

  const video=$('video-player');
  video.pause();
  video.removeAttribute('src');
  video.load();
  video.src=clip.render_url;
  video.load();

  const perf=clipPerformance(clip);

  $('video-modal-meta').innerHTML=`
    <div class="meta-row"><span>Status</span><strong>${esc(clip.status||'unknown')} · ${clip.publishing_approved?'approved for publishing':'needs approval'}</strong></div>
    <div class="meta-row"><span>Duration</span><strong>${clip.duration_seconds?Math.round(Number(clip.duration_seconds))+' seconds':'Unknown'}</strong></div>
    <div class="meta-row"><span>Performance</span><strong>${fmt(perf.views)} views · ${fmt(perf.comments)} comments</strong></div>
    <div class="meta-row"><span>Distribution</span><strong>${fmt(clip.queue_count)} jobs · ${fmt(clip.published_count)} published</strong></div>
    <div class="meta-row"><span>File</span><strong><a class="post-url" href="${esc(clip.render_url)}" target="_blank" rel="noopener">Open original ↗</a></strong></div>
  `;

  $('video-modal').hidden=false;
}

function closeVideoModal(){
  const video=$('video-player');
  video.pause();
  video.removeAttribute('src');
  video.load();
  $('video-modal').hidden=true;
}

function openClipDrawer(id){
  const clip=findClip(id);
  if(!clip) return;

  const perf=clipPerformance(clip);
  const distributions=clip.distributions||[];

  $('drawer-title').textContent=clip.title||'Clip';

  $('drawer-body').innerHTML=`
    <div class="detail-section">
      <h4>Overview</h4>
      <div class="detail-grid">
        <div class="detail-stat"><strong>${esc(clip.status||'unknown')}</strong><span>Clip status</span></div>
        <div class="detail-stat"><strong>${clip.publishing_approved?'Approved':'Waiting'}</strong><span>Publishing approval</span></div>
        <div class="detail-stat"><strong>${clip.duration_seconds?Math.round(Number(clip.duration_seconds))+'s':'—'}</strong><span>Duration</span></div>
        <div class="detail-stat"><strong>${fmt(clip.published_count)}</strong><span>Published posts</span></div>
      </div>
    </div>

    <div class="detail-section">
      <h4>Campaign</h4>
      <p>${esc(clip.campaign_name||'No campaign')}</p>
      ${clip.hook?`<p style="margin-top:8px"><strong>Hook:</strong> ${esc(clip.hook)}</p>`:''}
    </div>

    <div class="detail-section">
      <h4>Performance</h4>
      <div class="detail-grid">
        <div class="detail-stat"><strong>${fmt(perf.views)}</strong><span>Views</span></div>
        <div class="detail-stat"><strong>${fmt(perf.likes)}</strong><span>Likes</span></div>
        <div class="detail-stat"><strong>${fmt(perf.comments)}</strong><span>Comments</span></div>
        <div class="detail-stat"><strong>${fmt(perf.shares)}</strong><span>Shares</span></div>
      </div>
    </div>

    <div class="detail-section">
      <h4>Video</h4>
      ${clip.render_url
        ? `<div class="clip-actions"><button class="action-btn preview-clip-drawer">Preview video</button><a class="open-btn" href="${esc(clip.render_url)}" target="_blank" rel="noopener">Open file ↗</a></div>`
        : '<p>No render URL available.</p>'}
    </div>

    <div class="detail-section">
      <h4>Distribution jobs</h4>
      ${distributions.length
        ? distributions.map(d=>`
          <div class="distribution-card">
            <div class="distribution-card-top">
              <strong>${esc(platformLabel(d.platform))} · ${esc(d.account_username||'unassigned')}</strong>
              <span class="status-chip ${statusClass(d.status)}">${esc(d.status||'unknown')}</span>
            </div>
            <small>${d.finished_at?'Finished '+esc(dateShort(d.finished_at)):(d.scheduled_at?'Scheduled '+esc(dateShort(d.scheduled_at)):'No schedule')}</small>
            ${d.url?`<a class="post-url" href="${esc(d.url)}" target="_blank" rel="noopener">Open published post ↗</a>`:''}
          </div>
        `).join('')
        : '<p>No distribution jobs are attached to this clip yet.</p>'}
    </div>

    ${clip.publishing_approved===false?`
      <button id="drawer-approve" class="primary-inline-btn" style="width:100%">Approve Publishing</button>
    `:''}
  `;

  const preview=$('drawer-body').querySelector('.preview-clip-drawer');
  if(preview) preview.onclick=()=>openVideoModal(id);

  const approve=$('drawer-approve');
  if(approve) approve.onclick=()=>approveClip(id,approve);

  $('detail-drawer').hidden=false;
}

function closeDrawer(){
  $('detail-drawer').hidden=true;
}

function campaignFilterRows(){
  const status=$('campaign-status-filter')?.value||'all';
  const search=($('campaign-search')?.value||'').trim().toLowerCase();

  return (state.campaigns?.campaigns||[]).filter(c=>{
    if(status!=='all' && c.status!==status) return false;

    if(search){
      const hay=[
        c.name,
        c.description,
        c.pool_name,
        ...(c.channels||[]).map(x=>x.username),
        ...(c.platforms||[]).map(platformLabel)
      ].filter(Boolean).join(' ').toLowerCase();

      if(!hay.includes(search)) return false;
    }

    return true;
  });
}

function populatePresetOptions(){
  const presets=state.presets?.presets||[];
  const options=presets.map(p=>`<option value="${esc(p.slug)}" data-version="${Number(p.current_version||1)}">${esc(p.name||p.slug)} · v${Number(p.current_version||1)}</option>`).join('');

  const select=$('new-preset');
  if(select){
    const current=select.value;
    select.innerHTML=options||'<option value="source_native">Source Native</option>';
    if(current && [...select.options].some(o=>o.value===current)) select.value=current;
    else if([...select.options].some(o=>o.value==='podcast_clean')) select.value='podcast_clean';
  }

  const base=$('preset-base');
  if(base){
    const current=base.value;
    base.innerHTML='<option value="__dynamic_v14__">Blank Dynamic V14 · layer composer</option>'+(options||'');
    if(current && [...base.options].some(o=>o.value===current)) base.value=current;
    else if(!base.value) base.value='__dynamic_v14__';
  }
}

function campaignLiveProgress(campaignId){
  const campaign=(state.campaigns?.campaigns||[]).find(c=>c.id===campaignId)||null;
  if(!campaign) return null;
  const matches=(state.jobs?.jobs||[]).filter(job=>jobBelongsToCampaignGroup(job,campaign));
  if(!matches.length) return null;
  const active=matches.filter(j=>!['complete','failed'].includes(j.stage));
  const progress=matches.reduce((n,x)=>n+Number(x.progress||0),0)/matches.length;
  const knownEta=matches.map(x=>Number(x.eta_minutes)).filter(x=>Number.isFinite(x)&&x>0);
  return {
    progress,
    active_jobs:active.length,
    waiting:matches.some(x=>x.waiting),
    error:matches.some(x=>x.error),
    eta_minutes:knownEta.length?Math.max(...knownEta):0
  };
}

function etaLabel(job){
  if(job?.waiting) return 'Waiting for selection';
  if(job?.error) return 'Needs attention';
  if(job?.stage==='complete') return 'Complete';
  if(Number.isFinite(job?.eta_minutes) && job.eta_minutes>0) return `≈ ${Math.max(1,Math.round(job.eta_minutes))} min left`;
  return 'Working…';
}

function renderJobs(){
  const all=state.jobs?.jobs||[];
  const active=all.filter(j=>!['complete','failed'].includes(j.stage));
  const failures=all.filter(j=>j.error||j.stage==='failed');
  const rows=active.length||failures.length?[...failures,...active.filter(j=>!failures.includes(j))].slice(0,8):all.slice(0,6);
  if($('jobs-summary-text')) $('jobs-summary-text').textContent=`${active.length} active · ${failures.length} need attention · ${all.length} total`;

  if($('jobs-last-refresh')){
    const when=state.jobs?.refreshed_at?new Date(state.jobs.refreshed_at):null;
    $('jobs-last-refresh').textContent=when&&!Number.isNaN(when.getTime())
      ? `Updated ${when.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`
      : 'Live';
  }

  if(!$('clipper-jobs-list')) return;

  $('clipper-jobs-list').innerHTML=rows.length?rows.map(job=>{
    const campaign=campaignGroupForMemberId(job.campaign_id);
    const variants=job.variants||{};
    const stageClass=job.error?'failed':job.stage==='complete'?'complete':job.stage==='rendering'?'rendering':job.waiting?'waiting':'active';

    return `
      <div class="job-card ${stageClass}">
        <div class="job-card-head">
          <div class="job-title-wrap">
            <span class="job-pulse"></span>
            <div>
              <strong>${esc(job.title||'Clipper job')}</strong>
              <span>${esc(campaign?.name||'No campaign')} · ${esc(job.preset_slug||'source_native')}</span>
            </div>
          </div>
          <div class="job-eta">
            <strong>${esc(etaLabel(job))}</strong>
            <span>${Math.round(Number(job.progress||0))}%</span>
          </div>
        </div>

        <div class="job-progress-track"><div class="job-progress-fill" style="width:${Math.max(2,Math.min(100,Number(job.progress||0)))}%"></div></div>

        <div class="job-stage-row">
          <strong>${esc(job.stage_label||job.stage)}</strong>
          <span>${variants.approved||0}/${variants.total||0} clips ready</span>
        </div>

        <div class="job-stage-chips">
          <span class="mini-chip">Source: ${esc(job.source_status||'—')}</span>
          ${variants.planned? `<span class="mini-chip">${variants.planned} planned</span>`:''}
          ${variants.rendering? `<span class="mini-chip job-chip-live">${variants.rendering} rendering</span>`:''}
          ${variants.approved? `<span class="mini-chip">${variants.approved} approved</span>`:''}
          ${variants.failed? `<span class="mini-chip job-chip-error">${variants.failed} failed</span>`:''}
        </div>

        ${job.error_message?`<div class="job-error">${esc(job.error_message)}</div>`:''}
      </div>
    `;
  }).join(''):'<div class="empty-row">No Clipper jobs found yet. Create a campaign to submit a source.</div>';
}

function renderPresetLibrary(){
  if(!$('preset-library')) return;
  const presets=state.presets?.presets||[];
  $('preset-library').innerHTML=presets.length?presets.map(p=>`
    <article class="preset-card">
      <div class="preset-card-main">
        <div class="preset-icon">P</div>
        <div>
          <strong>${esc(p.name||p.slug)}</strong>
          <span>${esc(p.description||p.category||'Clipper preset')}</span>
        </div>
      </div>
      <div class="preset-card-meta">
        <span class="mini-chip">v${Number(p.current_version||1)}</span>
        <span class="mini-chip">${esc(p.renderer_contract_version||'13.6')}</span>
        ${p.is_system?'<span class="mini-chip">system</span>':''}
        <button class="open-btn preset-design-preview" type="button" data-slug="${esc(p.slug)}">View design</button>
        ${p.preview_url?`<a class="open-btn" href="${esc(p.preview_url)}" target="_blank" rel="noopener">Rendered sample ↗</a>`:''}
      </div>
    </article>
  `).join(''):'<div class="empty-row">No presets found. Make sure the Clipper preset registry migration has been installed.</div>';
}

function openCreateCampaign(){
  populatePresetOptions();
  $('create-campaign-message').textContent='';
  $('create-campaign-modal').hidden=false;
  setTimeout(()=>$('new-campaign-name')?.focus(),50);
}
function closeCreateCampaign(){ $('create-campaign-modal').hidden=true; }

function openPresets(){
  populatePresetOptions();
  renderPresetLibrary();
  $('preset-message').textContent='';
  $('presets-modal').hidden=false;
  requestAnimationFrame(()=>window.__alchemicPresetPreview?.open?.());
}
function closePresets(){ $('presets-modal').hidden=true; }

async function submitCreateCampaign(event){
  event.preventDefault();
  const btn=$('submit-campaign');
  btn.disabled=true;
  btn.textContent='Creating…';
  $('create-campaign-message').textContent='Submitting source to Clipper…';
  $('create-campaign-message').className='connector-message';

  try{
    const presetSlug=$('new-preset').value||'source_native';
    const preset=(state.presets?.presets||[]).find(p=>p.slug===presetSlug);
    const result=await api('/api/clipper/campaigns/create',{
      method:'POST',
      headers:{'x-media-password':WRITE_KEY},
      body:{
        name:$('new-campaign-name').value,
        source_url:$('new-source-url').value,
        source_title:$('new-source-title').value,
        preset_slug:presetSlug,
        preset_version:Number(preset?.current_version||1),
        desired_clips:Number($('new-clip-count').value||3),
        operation_mode:$('new-operation-mode').value,
        selector_mode:$('new-selector-mode').value,
        editing_prompt:$('new-editing-prompt').value,
        cta_text:$('new-cta-text').value,
        brief:$('new-campaign-brief').value,
        rights_confirmed:$('new-rights-confirmed').checked
      }
    });

    $('create-campaign-message').textContent=result.message||'Campaign queued.';
    $('create-campaign-message').className='connector-message success';
    await refreshMediaData();
    await refreshJobs();

    setTimeout(()=>{
      closeCreateCampaign();
      $('create-campaign-form').reset();
      setView('campaigns');
    },650);
  }catch(error){
    $('create-campaign-message').textContent=error.message;
    $('create-campaign-message').className='connector-message error';
  }finally{
    btn.disabled=false;
    btn.textContent='Create & Queue';
  }
}

async function submitPreset(event){
  event.preventDefault();
  const btn=$('save-preset');
  btn.disabled=true;
  btn.textContent='Saving…';
  $('preset-message').textContent='Saving preset…';
  $('preset-message').className='connector-message';

  try{
    let presetJson=null;
    const raw=$('preset-json').value.trim();
    if(raw){
      try{presetJson=JSON.parse(raw);}catch{throw new Error('Advanced preset JSON is not valid JSON');}
    }
    if(!presetJson && $('preset-base').value==='__dynamic_v14__'){
      presetJson=window.__alchemicPresetPreview?.starterPreset?.()||null;
    }

    const result=await api('/api/clipper/presets',{
      method:'POST',
      headers:{'x-media-password':WRITE_KEY},
      body:{
        name:$('preset-name').value,
        slug:$('preset-slug').value,
        description:$('preset-description').value,
        base_preset_slug:$('preset-base').value==='__dynamic_v14__'?null:$('preset-base').value,
        preview_url:$('preset-preview-url').value||null,
        preset_json:presetJson
      }
    });

    state.presets=await api('/api/clipper/presets');
    populatePresetOptions();
    renderPresetLibrary();
    $('create-preset-form').reset();
    window.__alchemicPresetPreview?.reset?.();
    $('preset-message').textContent=`Saved ${result.preset?.name||'preset'}.`;
    $('preset-message').className='connector-message success';
  }catch(error){
    $('preset-message').textContent=error.message;
    $('preset-message').className='connector-message error';
  }finally{
    btn.disabled=false;
    btn.textContent='Save Preset';
  }
}

async function refreshJobs(){
  try{
    state.jobs=await api('/api/clipper/jobs');
    renderJobs();
    renderCampaigns();
    if(state.view==='clipping') renderClips();
  }catch(error){
    console.warn('Clipper progress refresh failed',error);
    if($('jobs-last-refresh')) $('jobs-last-refresh').textContent='Refresh failed';
  }
}

function renderCampaigns(){
  const s=state.campaigns?.summary||{};

  $('campaign-summary').innerHTML=[
    stat('Campaigns',s.total||0,'blue','▤'),
    stat('Published',s.published||0,'green','▶'),
    stat('Views',s.views||0,'orange','↗'),
    stat('Messages',s.messages||0,'purple','✉'),
    stat('DM Threads',s.conversations||0,'cyan','◉'),
    stat('Link Clicks',s.link_clicks||0,'blue','↗')
  ].join('');

  const rows=campaignFilterRows();

  $('campaign-grid').innerHTML=rows.length
    ? rows.map(campaign=>`
      <article class="campaign-card">
        <div class="campaign-card-head">
          <div>
            <h3>${esc(campaign.name||'Untitled campaign')}</h3>
            <p>${esc(campaign.description||campaign.pool_name||'Media distribution campaign')}</p>
          </div>
          <span class="campaign-status ${campaign.status==='active'?'active':''}">${esc(campaign.status||'unknown')}</span>
        </div>

        ${(()=>{
          const live=campaignLiveProgress(campaign.id);
          if(!live) return '';
          const progress=Math.max(0,Math.min(100,Number(live.progress||0)));
          const eta=live.waiting?'Waiting for selection':(live.error?'Needs attention':(live.eta_minutes?`≈ ${Math.round(live.eta_minutes)} min left`:(progress>=100?'Complete':'Working…')));
          return `
            <div class="campaign-live-progress">
              <div class="campaign-live-head"><span>Clipper progress</span><strong>${esc(eta)}</strong></div>
              <div class="job-progress-track"><div class="job-progress-fill" style="width:${progress}%"></div></div>
              <div class="campaign-live-foot"><span>${progress}%</span><span>${fmt(live.active_jobs||0)} active source${Number(live.active_jobs||0)===1?'':'s'}</span></div>
            </div>
          `;
        })()}

        <div class="campaign-kpis campaign-kpis-six">
          <div class="campaign-kpi"><strong>${fmt(campaign.clips)}</strong><span>clips</span></div>
          <div class="campaign-kpi"><strong>${fmt(campaign.published)}</strong><span>published</span></div>
          <div class="campaign-kpi"><strong>${fmt(campaign.views)}</strong><span>views</span></div>
          <div class="campaign-kpi"><strong>${fmt(campaign.messages)}</strong><span>messages</span></div>
          <div class="campaign-kpi"><strong>${fmt(campaign.conversations)}</strong><span>DM threads</span></div>
          <div class="campaign-kpi"><strong>${fmt(campaign.link_clicks)}</strong><span>link clicks</span></div>
        </div>

        ${Number(campaign.needs_approval||0)>0
          ? `<div class="campaign-attention">${fmt(campaign.needs_approval)} clips need approval</div>`
          : ''}

        <div class="campaign-meta campaign-meta-compact">
          <div class="campaign-meta-row"><span>Queue</span><strong>${fmt(campaign.ready)} ready · ${fmt(campaign.running)} running · ${fmt(campaign.failed)} failed</strong></div>
          <div class="campaign-meta-row">
            <span>Platforms</span>
            <strong class="campaign-platforms">${(campaign.platforms||[]).length?(campaign.platforms||[]).map(p=>`<span class="mini-chip">${esc(platformLabel(p))}</span>`).join(''):'—'}</strong>
          </div>
          <div class="campaign-meta-row">
            <span>Channels</span>
            <strong class="campaign-channels">${(campaign.channels||[]).length?(campaign.channels||[]).slice(0,4).map(a=>`<span class="mini-chip">${esc(a.username)}</span>`).join(''):'—'}${(campaign.channels||[]).length>4?`<span class="mini-chip">+${campaign.channels.length-4}</span>`:''}</strong>
          </div>
        </div>

        <div class="campaign-actions">
          <button class="secondary-btn campaign-clips" data-id="${esc(campaign.id)}">View Clips</button>
          <button class="secondary-btn campaign-content" data-id="${esc(campaign.id)}">View Content</button>
        </div>
      </article>
    `).join('')
    : '<div class="card empty-row">No campaigns yet. Create your first campaign to get started.</div>';

  document.querySelectorAll('.campaign-clips').forEach(btn=>{
    btn.onclick=()=>{
      setView('clipping');
      $('clip-campaign-filter').value=btn.dataset.id;
      $('clip-status-filter').value='all';
      renderClips();
    };
  });

  document.querySelectorAll('.campaign-content').forEach(btn=>{
    btn.onclick=()=>{
      setView('content');
      $('content-campaign-filter').value=btn.dataset.id;
      renderContent();
    };
  });
}

function contentFilterRows(){
  const platform=$('content-platform-filter')?.value||'all';
  const status=$('content-status-filter')?.value||'all';
  const campaign=$('content-campaign-filter')?.value||'all';
  const dateWindow=$('content-date-filter')?.value||'all';
  const cutoff=dateWindow==='all'?null:(Date.now()-Number(dateWindow)*86400000);

  return (state.content?.rows||[]).filter(row=>{
    if(platform!=='all' && row.platform!==platform) return false;
    if(status!=='all' && row.status!==status) return false;
    if(campaign!=='all' && !campaignMemberIds(campaign).has(row.campaign_id)) return false;
    if(cutoff && new Date(row.finished_at||row.created_at||0).getTime()<cutoff) return false;
    return true;
  });
}

function renderContent(){
  const rows=contentFilterRows();

  $('content-summary').innerHTML=[
    stat('Queue Jobs',rows.length,'blue','▶'),
    stat('Published',rows.filter(x=>x.status==='done'||x.external_post_id||x.external_post_url).length,'green','✓'),
    stat('Ready',rows.filter(x=>x.status==='ready').length,'orange','•'),
    stat('Running',rows.filter(x=>x.status==='running').length,'purple','↻'),
    stat('Views',rows.reduce((n,x)=>n+Number(x.views||0),0),'cyan','↗')
  ].join('');

  $('content-table').innerHTML=rows.length
    ? rows.map(x=>`
      <tr>
        <td>
          <strong>${esc(x.title||'Content')}</strong>
          <div class="hook-text">${esc(x.campaign_name||'No campaign')}</div>
          ${x.caption?`<div class="hook-text">${esc(x.caption.slice(0,140))}</div>`:''}
        </td>
        <td><span class="platform-chip">${esc(platformLabel(x.platform))}</span></td>
        <td>${esc(x.account_username||'—')}</td>
        <td><span class="status-chip ${statusClass(x.status)}">${esc(x.status||'—')}</span></td>
        <td>${fmt(x.views)}</td>
        <td>${fmt(x.comments)}</td>
        <td>${x.source_url?`<button class="open-btn preview-content" data-url="${esc(x.source_url)}" data-title="${esc(x.title||'Clip')}">Preview</button>`:'—'}</td>
        <td>${x.external_post_url
          ? `<a class="post-url" href="${esc(x.external_post_url)}" target="_blank" rel="noopener">Published post ↗</a>`
          : (x.external_post_id?esc(x.external_post_id):'—')}</td>
        <td>${x.error?`<span style="color:#b91c1c">${esc(x.error)}</span>`:'—'}</td>
      </tr>
    `).join('')
    : '<tr><td class="empty-row" colspan="9">No queue rows match the current filters.</td></tr>';

  document.querySelectorAll('.preview-content').forEach(btn=>{
    btn.onclick=()=>openRawVideo(btn.dataset.url,btn.dataset.title);
  });
}

function openRawVideo(url,title){
  $('video-modal-title').textContent=title||'Clip Preview';
  $('video-modal-subtitle').textContent='Content asset';

  const video=$('video-player');
  video.pause();
  video.removeAttribute('src');
  video.load();
  video.src=url;
  video.load();

  $('video-modal-meta').innerHTML=`
    <div class="meta-row"><span>File</span><strong><a class="post-url" href="${esc(url)}" target="_blank" rel="noopener">Open original ↗</a></strong></div>
  `;

  $('video-modal').hidden=false;
}

function populateConnectorOptions(){
  const data=state.data||{campaigns:[],pools:[]};

  const campaignSelect=$('connector-campaign');
  const poolSelect=$('connector-pool');

  if(campaignSelect){
    const current=campaignSelect.value||'';
    campaignSelect.innerHTML='<option value="">No campaign assignment</option>'+((data.campaigns||[]).map(c=>`<option value="${esc(c.id)}">${esc(c.name||'Untitled campaign')}</option>`).join(''));
    if([...campaignSelect.options].some(o=>o.value===current)) campaignSelect.value=current;
  }

  if(poolSelect){
    const current=poolSelect.value||'';
    poolSelect.innerHTML='<option value="">No pool assignment</option>'+((data.pools||[]).map(p=>`<option value="${esc(p.id)}">${esc(p.name||p.slug||'Distribution pool')}</option>`).join(''));
    if([...poolSelect.options].some(o=>o.value===current)) poolSelect.value=current;
  }
}

function channelActionMessage(message,tone=''){
  const target=$('channel-action-message');
  if(target){target.textContent=message;target.className='channel-action-message '+tone;}
}

async function startConnector(provider,reconnectAccountId=null){
  const config=state.config||{providers:{}};
  const ready=config.providers?.[provider]?.ready;

  if(!ready){
    const providerName=provider==='instagram'?'Instagram':provider==='facebook'?'Facebook':'YouTube';
    channelActionMessage(`${providerName} app credentials are not configured in this Netlify project yet.`,'error');
    return;
  }

  const params=new URLSearchParams({
    provider,
    campaignId:$('connector-campaign')?.value||'',
    poolId:$('connector-pool')?.value||'',
    dailyLimit:$('connector-daily')?.value||'4',
    weeklyLimit:$('connector-weekly')?.value||'28',
    minGapMinutes:$('connector-gap')?.value||'60',
    ...(reconnectAccountId?{reconnectAccountId}:{})
  });

  const button=provider==='instagram'
    ? $('connect-instagram')
    : provider==='facebook'
      ? $('connect-facebook')
      : $('connect-youtube');
  if(button) button.disabled=true;

  channelActionMessage(`Opening ${provider==='instagram'?'Instagram':provider==='facebook'?'Facebook':'Google'} authorization…`);

  try{
    const result=await api(`/api/oauth/start?${params.toString()}`,{
      headers:{'x-media-password':WRITE_KEY}
    });

    if(!result.authorizationUrl) throw new Error('OAuth URL was not returned');
    window.location.href=result.authorizationUrl;
  }catch(error){
    channelActionMessage(error.message,'error');
    if(button) button.disabled=false;
  }
}

function renderAccounts(){
  const data=state.data||{accounts:[],usage_summary:{}};
  const config=state.config||{providers:{}};
  const accounts=data.accounts||[];
  const usage=data.usage_summary||{};

  populateConnectorOptions();

  $('account-count').textContent=`${accounts.length} channels`;

  if($('channel-summary')){
    $('channel-summary').innerHTML=[
      stat('Used Today',usage.used_today||0,'orange','▶'),
      stat('Lifetime Posts',usage.total_published||0,'green','✓'),
      stat('Queued Now',usage.queued_now||0,'purple','↻'),
      stat('Channels',accounts.length,'cyan','◎')
    ].join('');
  }

  $('ig-provider-status').textContent=config.providers?.instagram?.ready
    ? 'Connector configured'
    : 'Add Instagram app keys in Netlify';

  $('fb-provider-status').textContent=config.providers?.facebook?.ready
    ? 'Messenger connector configured'
    : 'Add Facebook app keys in Netlify';

  $('yt-provider-status').textContent=config.providers?.youtube?.ready
    ? 'Connector configured'
    : 'Add Google OAuth keys in Netlify';

  if($('connect-instagram')){
    $('connect-instagram').disabled=!config.providers?.instagram?.ready;
    $('connect-instagram-status').textContent=config.providers?.instagram?.ready
      ? 'Connect another professional account'
      : 'Add Instagram app keys in Netlify';
  }

  if($('connect-facebook')){
    $('connect-facebook').disabled=!config.providers?.facebook?.ready;
    $('connect-facebook-status').textContent=config.providers?.facebook?.ready
      ? 'Connect Pages you manage'
      : 'Add Facebook app keys in Netlify';
  }

  if($('connect-youtube')){
    $('connect-youtube').disabled=!config.providers?.youtube?.ready;
    $('connect-youtube-status').textContent=config.providers?.youtube?.ready
      ? 'Connect another YouTube channel'
      : 'Add Google OAuth keys in Netlify';
  }

  $('accounts-table').innerHTML=accounts.length
    ? accounts.map(account=>{
      const caps=account.capabilities_json||{};
      const daily=Number(account.daily_limit||0);
      const used=Number(account.used_today||0);
      const remaining=account.daily_remaining==null?'∞':fmt(account.daily_remaining);
      const percent=Number(account.daily_usage_percent||0);

      const inboxCell=account.inbox_state==='ready'
        ? `<div class="inbox-ready-actions"><span class="status-chip status-approved">Ready</span><button class="sync-inbox-btn open-btn" data-id="${esc(account.id)}" type="button">Sync</button></div>`
        : account.inbox_state==='activate'
          ? `<button class="activate-inbox-btn open-btn" data-id="${esc(account.id)}" type="button">Activate inbox</button>`
          : account.inbox_state==='reconnect_required'
            ? `<button class="reconnect-channel-btn open-btn" data-id="${esc(account.id)}" type="button">Reconnect DMs</button>`
            : '—';

      const analyticsCell=account.platform==='instagram_reels'
        ? (account.insights_permission
            ? '<span class="status-chip status-approved">Insights ready</span>'
            : '<span class="status-chip status-running">Reconnect for Insights</span>')
        : account.platform==='youtube_shorts'
          ? (account.insights_permission
              ? '<span class="status-chip status-approved">Daily analytics</span>'
              : '<span class="status-chip status-other">Totals only</span>')
          : '—';

      return `
        <tr>
          <td><strong>${esc(account.username||account.display_name||'Unnamed')}</strong></td>
          <td><span class="platform-chip">${esc(platformLabel(account.platform))}</span></td>
          <td><span class="status-chip ${account.is_active!==false?'active':'inactive'}">${account.is_active!==false?'Active':'Paused'}</span></td>
          <td>
            <div class="usage-cell">
              <strong>${fmt(used)}${daily?` / ${fmt(daily)}`:''}</strong>
              <div class="usage-track"><span style="width:${Math.min(100,percent)}%"></span></div>
            </div>
          </td>
          <td>
            <div class="channel-limit-editor">
              <input class="channel-daily-limit" data-id="${esc(account.id)}" type="number" min="0" max="10000" value="${daily}">
              <button class="save-channel-limit" data-id="${esc(account.id)}" type="button">Save</button>
            </div>
          </td>
          <td>${remaining}</td>
          <td>${fmt(account.total_published||0)}</td>
          <td>${fmt(account.queued_now||0)}</td>
          <td>${inboxCell}</td>
          <td>${analyticsCell}</td>
          <td>${esc(account.webhook_status||'not configured')}</td>
          <td><button class="remove-channel-btn open-btn" data-id="${esc(account.id)}" type="button">Remove</button></td>
        </tr>
      `;
    }).join('')
    : '<tr><td class="empty-row" colspan="12">No channels yet. Click Add Channels to connect your first account.</td></tr>';

  document.querySelectorAll('.save-channel-limit').forEach(button=>{
    button.onclick=()=>saveChannelLimit(button.dataset.id);
  });
  document.querySelectorAll('.activate-inbox-btn').forEach(button=>{
    button.onclick=()=>activateExistingInbox(button.dataset.id,button);
  });
  document.querySelectorAll('.sync-inbox-btn').forEach(button=>{
    button.onclick=()=>syncExistingInbox(button.dataset.id,button);
  });
  document.querySelectorAll('.reconnect-channel-btn').forEach(button=>{
    button.onclick=()=>reconnectChannel(button.dataset.id);
  });
  document.querySelectorAll('.remove-channel-btn').forEach(button=>{
    button.onclick=()=>removeChannel(button.dataset.id,button);
  });
}

function reconnectChannel(accountId){
  const account=(state.data?.accounts||[]).find(a=>a.id===accountId);
  if(!account){channelActionMessage('Channel not found. Refresh and try again.','error');return;}
  const provider=account.platform==='instagram_reels'?'instagram':account.platform==='facebook_page'||account.platform==='facebook'?'facebook':null;
  if(!provider){channelActionMessage('DM reconnect is only available for Instagram and Facebook Pages.','error');return;}
  return startConnector(provider,accountId);
}

async function removeChannel(accountId,button){
  const account=(state.data?.accounts||[]).find(a=>a.id===accountId);
  if(!account) return;
  if(!window.confirm(`Remove @${account.username||account.display_name||'this channel'} from Alchemic Media? Its publishing and DM connection will stop. Published posts and message history will be kept.`)) return;
  button.disabled=true;
  try{
    await api('/api/channels/remove',{method:'POST',body:{accountId}});
    channelActionMessage(`@${account.username||'Channel'} removed. Historical posts and conversations were kept.`,'success');
    await refreshChannelData();
    if(window.loadAlchemicInboxHealth) await window.loadAlchemicInboxHealth();
  }catch(error){
    channelActionMessage(error.message,'error');
    await refreshChannelData().catch(()=>{});
    button.disabled=false;
  }
}

async function refreshChannelData(){
  const offset=new Date().getTimezoneOffset();
  state.data=await api(`/api/data?tzOffsetMinutes=${encodeURIComponent(offset)}`);
  renderAccounts();
}

async function activateExistingInbox(accountId,button){
  const original=button?.textContent||'Activate inbox';
  if(button){button.disabled=true;button.textContent='Activating…';}
  try{
    const result=await api('/api/channels/inbox/activate',{
      method:'POST',
      body:{accountId}
    });
    channelActionMessage(result.state==='ready'
        ? 'Inbox activated with the existing account token. No reconnect was needed.'
        : 'Inbox activation needs attention.',result.state==='ready'?'success':'error');
    await refreshChannelData();
  }catch(error){
    channelActionMessage(error.message,'error');
    if(button){button.disabled=false;button.textContent=original;}
  }
}

async function syncExistingInbox(accountId,button){
  const original=button?.textContent||'Sync';
  if(button){button.disabled=true;button.textContent='Syncing…';}
  try{
    const result=await api('/api/channels/inbox/sync',{
      method:'POST',
      body:{accountId}
    });
    channelActionMessage(`Inbox synced: ${result.conversations||0} conversations, ${result.messages_inserted||0} new messages.`,'success');
    await refreshChannelData();
    if(window.loadAlchemicInbox) await window.loadAlchemicInbox();
  }catch(error){
    channelActionMessage(error.message,'error');
  }finally{
    if(button){button.disabled=false;button.textContent=original;}
  }
}

async function saveChannelLimit(accountId){
  const input=[...document.querySelectorAll('.channel-daily-limit')].find(el=>el.dataset.id===accountId);
  if(!input) return;

  try{
    await api('/api/channels/settings',{
      method:'POST',
      body:{accountId,dailyLimit:Number(input.value||0)}
    });
    await refreshChannelData();
  }catch(error){
    alert(error.message);
  }
}

async function applyDailyLimitToAll(){
  const value=Number($('bulk-daily-limit')?.value||0);
  const button=$('apply-all-daily-limit');
  button.disabled=true;
  button.textContent='Applying…';

  try{
    await api('/api/channels/settings',{
      method:'POST',
      body:{applyAll:true,dailyLimit:value}
    });
    await refreshChannelData();
  }catch(error){
    alert(error.message);
  }finally{
    button.disabled=false;
    button.textContent='Apply daily limit to all';
  }
}

function renderSettings(){
  const profile=state.auth?.profile||{};
  const user=state.auth?.user||{};
  const workspace=state.auth?.workspace||state.settings?.workspace||{};

  if($('settings-full-name')) $('settings-full-name').value=profile.full_name||'';
  if($('settings-email')) $('settings-email').value=user.email||profile.email||'';
  if($('settings-role')) $('settings-role').value=state.settings?.membership?.role||profile.role||'member';
  if($('settings-workspace-name')) $('settings-workspace-name').value=workspace.name||'';
  if($('settings-workspace-id')) $('settings-workspace-id').value=workspace.id||'Workspace migration pending';
}

async function loadSettings(){
  try{
    const result=await api('/api/settings');
    state.settings=result;
    if(result.profile) state.auth.profile={...state.auth.profile,...result.profile};
    if(result.workspace) state.auth.workspace=result.workspace;
    renderSettings();
  }catch(error){
    if($('profile-settings-message')){
      $('profile-settings-message').textContent=error.message;
      $('profile-settings-message').className='connector-message error';
    }
  }
}

async function saveProfileSettings(event){
  event.preventDefault();
  const message=$('profile-settings-message');
  try{
    const result=await api('/api/settings',{method:'POST',body:{fullName:$('settings-full-name').value}});
    if(result.profile) state.auth.profile={...state.auth.profile,...result.profile};
    message.textContent='Profile saved.';
    message.className='connector-message success';
    renderSettings();
  }catch(error){
    message.textContent=error.message;
    message.className='connector-message error';
  }
}

async function saveWorkspaceSettings(event){
  event.preventDefault();
  const message=$('workspace-settings-message');
  try{
    const result=await api('/api/settings',{method:'POST',body:{workspaceName:$('settings-workspace-name').value}});
    if(result.workspace) state.auth.workspace=result.workspace;
    message.textContent='Workspace saved.';
    message.className='connector-message success';
    renderSettings();
  }catch(error){
    message.textContent=error.message;
    message.className='connector-message error';
  }
}

async function savePasswordSettings(event){
  event.preventDefault();
  const password=$('settings-password').value;
  const confirm=$('settings-password-confirm').value;
  const message=$('password-settings-message');

  if(password!==confirm){
    message.textContent='Passwords do not match.';
    message.className='connector-message error';
    return;
  }

  try{
    await api('/api/settings',{method:'POST',body:{newPassword:password}});
    $('settings-password').value='';
    $('settings-password-confirm').value='';
    message.textContent='Password changed.';
    message.className='connector-message success';
  }catch(error){
    message.textContent=error.message;
    message.className='connector-message error';
  }
}

function renderAll(){
  populateCampaignFilters();
  renderOverview();
  renderClips();
  renderCampaigns();
  renderJobs();
  renderPresetLibrary();
  renderContent();
  renderAccounts();
  renderSettings();
}

async function refreshMediaData(){
  const [clips,content,campaigns,jobs]=await Promise.all([
    api('/api/clips'),
    api('/api/content'),
    api('/api/campaigns'),
    api('/api/clipper/jobs')
  ]);

  state.clips=clips;
  state.content=content;
  state.campaigns=campaigns;
  state.jobs=jobs;

  populateCampaignFilters();
  renderOverview();
  renderClips();
  renderCampaigns();
  renderJobs();
  renderContent();
}

async function load(){
  try{
    const tzOffsetMinutes=new Date().getTimezoneOffset();
    const [dashboard,data,config,clips,content,campaigns,jobs,presets,settings]=await Promise.all([
      api('/api/dashboard'),
      api('/api/data?tzOffsetMinutes='+encodeURIComponent(tzOffsetMinutes)),
      api('/api/config'),
      api('/api/clips'),
      api('/api/content'),
      api('/api/campaigns'),
      api('/api/clipper/jobs'),
      api('/api/clipper/presets'),
      api('/api/settings')
    ]);

    state.dashboard=dashboard;
    state.data=data;
    state.config=config;
    state.clips=clips;
    state.content=content;
    state.campaigns=campaigns;
    state.jobs=jobs;
    state.presets=presets;
    state.settings=settings;
    if(settings?.profile) state.auth.profile={...state.auth.profile,...settings.profile};
    if(settings?.workspace) state.auth.workspace=settings.workspace;

    renderAll();
  }catch(error){
    console.error(error);
    $('summary-cards').innerHTML=`
      <div class="notice" style="grid-column:1/-1">
        <div class="notice-icon">!</div>
        <div><strong>Database setup still needs attention</strong><p>${esc(error.message)}</p></div>
      </div>
    `;
  }
}

document.querySelectorAll('.nav-item').forEach(el=>{
  el.addEventListener('click',()=>setView(el.dataset.view));
});

document.querySelectorAll('[data-jump]').forEach(el=>{
  el.addEventListener('click',()=>setView(el.dataset.jump));
});

$('refresh-all').addEventListener('click',load);
if($('open-settings-menu')) $('open-settings-menu').addEventListener('click',()=>{
  $('user-menu-popover').hidden=true;
  setView('settings');
  loadSettings();
});

$('clip-status-filter').addEventListener('change',renderClips);
$('clip-campaign-filter').addEventListener('change',renderClips);
$('clip-platform-filter').addEventListener('change',renderClips);
$('clip-date-filter').addEventListener('change',renderClips);
$('clip-search').addEventListener('input',renderClips);

$('campaign-status-filter').addEventListener('change',renderCampaigns);
$('campaign-search').addEventListener('input',renderCampaigns);

$('open-create-campaign').addEventListener('click',openCreateCampaign);
$('open-presets').addEventListener('click',openPresets);
$('create-campaign-form').addEventListener('submit',submitCreateCampaign);
$('create-preset-form').addEventListener('submit',submitPreset);
document.querySelectorAll('[data-close-create-campaign]').forEach(el=>el.addEventListener('click',closeCreateCampaign));
document.querySelectorAll('[data-close-presets]').forEach(el=>el.addEventListener('click',closePresets));

$('content-platform-filter').addEventListener('change',renderContent);
$('content-status-filter').addEventListener('change',renderContent);
$('content-campaign-filter').addEventListener('change',renderContent);
$('content-date-filter').addEventListener('change',renderContent);

if($('connect-instagram')) $('connect-instagram').addEventListener('click',()=>startConnector('instagram'));
if($('connect-facebook')) $('connect-facebook').addEventListener('click',()=>startConnector('facebook'));
if($('connect-youtube')) $('connect-youtube').addEventListener('click',()=>startConnector('youtube'));

if($('toggle-add-channel')) $('toggle-add-channel').addEventListener('click',()=>{
  const panel=$('add-channel-panel');
  const opening=panel.hidden;
  panel.hidden=!panel.hidden;
  $('toggle-add-channel').textContent=opening?'− Hide Add Channels':'+ Add Channels';
  if(opening) panel.scrollIntoView({behavior:'smooth',block:'nearest'});
});

if($('apply-all-daily-limit')) $('apply-all-daily-limit').addEventListener('click',applyDailyLimitToAll);

if($('profile-settings-form')) $('profile-settings-form').addEventListener('submit',saveProfileSettings);
if($('workspace-settings-form')) $('workspace-settings-form').addEventListener('submit',saveWorkspaceSettings);
if($('password-settings-form')) $('password-settings-form').addEventListener('submit',savePasswordSettings);

$('select-visible-clips').addEventListener('change',event=>{
  const visible=clipFilterRows().filter(x=>x.publishing_approved===false);
  for(const clip of visible){
    if(event.target.checked) state.selectedClips.add(clip.id);
    else state.selectedClips.delete(clip.id);
  }
  renderClips();
});

$('clear-selection').addEventListener('click',()=>{
  state.selectedClips.clear();
  renderClips();
});

$('bulk-approve').addEventListener('click',bulkApprove);

document.querySelectorAll('[data-close-modal]').forEach(el=>{
  el.addEventListener('click',closeVideoModal);
});

document.querySelectorAll('[data-close-drawer]').forEach(el=>{
  el.addEventListener('click',closeDrawer);
});

document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){
    closeVideoModal();
    closeDrawer();
    closeCreateCampaign();
    closePresets();
  }
});

$('sync-metrics').addEventListener('click',async()=>{
  const btn=$('sync-metrics');
  btn.disabled=true;
  btn.textContent='Syncing…';

  try{
    const result=await api('/api/metrics/sync',{
      method:'POST',
      headers:{'x-media-password':WRITE_KEY},
      body:{limit:100}
    });

    await refreshMediaData();

    const failed=(result.results||[]).filter(x=>x.status==='failed').length;
    if(failed) alert(`Metrics sync completed with ${failed} failed posts.`);
  }catch(error){
    alert(error.message);
  }finally{
    btn.disabled=false;
    btn.textContent='Sync metrics';
  }
});

setInterval(()=>{
  if(document.hidden || !state.auth?.accessToken) return;
  refreshJobs();
},10000);

const initialView=new URLSearchParams(window.location.search).get('view');
if(['overview','clipping','campaigns','content','inbox','leads','accounts','settings'].includes(initialView)) setView(initialView);

window.__alchemic={
  state,
  api,
  load,
  setView,
  esc,
  fmt,
  platformLabel,
  dateShort,
  loadSettings,
  renderSettings
};
window.connectAlchemicChannel=reconnectChannel;
window.dispatchEvent(new Event('alchemic-ready'));
