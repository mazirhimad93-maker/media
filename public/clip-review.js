const media=window.__alchemic;
if(!media) throw new Error('Alchemic core unavailable');

const {state,api,esc,fmt,platformLabel,dateShort}=media;
const $=id=>document.getElementById(id);

function findClip(id){
  return (state.clips?.clips||[]).find(x=>String(x.id)===String(id))||null;
}

async function recover(clip){
  if(!clip||clip.render_url||!clip.render_status_url||String(clip.id||'').startsWith('asset:')) return clip?.render_url||null;
  try{
    const result=await api('/api/clips/render/recover',{method:'POST',body:{id:clip.id}});
    if(result?.render_url){
      clip.render_url=result.render_url;
      return result.render_url;
    }
  }catch(error){
    console.warn('Clip render recovery:',error);
  }
  return null;
}

function performance(clip){
  let views=0,likes=0,comments=0,shares=0;
  const content=state.content?.rows||[];
  const ids=new Set((clip.distributions||[]).map(x=>x.id));
  for(const row of content){
    if((row.asset_id&&row.asset_id===clip.asset?.id)||ids.has(row.queue_id)){
      views+=Number(row.views||0);likes+=Number(row.likes||0);comments+=Number(row.comments||0);shares+=Number(row.shares||0);
    }
  }
  return {views,likes,comments,shares};
}

function previewSource(clip){
  if(clip.render_url) return {url:clip.render_url,final:true};
  if(clip.source_preview_url) return {url:clip.source_preview_url,final:false};
  return {url:null,final:false};
}

function seekFallback(video,clip){
  if(!video||clip.render_url||!Number(clip.source_start_seconds||0)) return;
  video.addEventListener('loadedmetadata',()=>{
    try{video.currentTime=Number(clip.source_start_seconds||0)}catch{}
  },{once:true});
}

async function openEnhancedDrawer(id){
  const clip=findClip(id);
  if(!clip) return;

  if(!clip.render_url&&clip.render_status_url) await recover(clip);
  const p=performance(clip);
  const source=previewSource(clip);
  const distributions=clip.distributions||[];

  $('drawer-title').textContent=clip.title||'Clip';
  $('drawer-body').innerHTML=`
    <section class="detail-section clip-approval-preview">
      <div class="clip-review-head">
        <div>
          <h4>Approval Preview</h4>
          <p>${source.final?'Final rendered output from the Clipper.':source.url?'Source segment fallback. The final rendered file is not recorded for this row.':'This clip does not have a playable output URL recorded.'}</p>
        </div>
        <span class="status-chip">${esc(clip.status||'unknown')}</span>
      </div>

      ${source.url?`
        <div class="drawer-video-stage">
          <video class="drawer-video-player" controls playsinline preload="metadata" src="${esc(source.url)}" poster="${esc(clip.thumbnail_url||'')}"></video>
          ${source.final?'':'<div class="preview-warning">SOURCE SEGMENT · NOT FINAL RENDER</div>'}
        </div>
      `:`
        <div class="missing-render-card">
          <strong>Rendered video unavailable</strong>
          <span>${clip.render_job_id?'Renderer job '+esc(clip.render_job_id)+' exists, but no final output URL could be recovered.':'No render job/output URL is attached to this legacy clip.'}</span>
        </div>
      `}
    </section>

    <section class="detail-section">
      <h4>Approval</h4>
      <div class="detail-grid">
        <div class="detail-stat"><strong>${clip.publishing_approved?'Approved':'Waiting'}</strong><span>Publishing</span></div>
        <div class="detail-stat"><strong>${esc(clip.status||'unknown')}</strong><span>Render status</span></div>
        <div class="detail-stat"><strong>${clip.duration_seconds?Math.round(Number(clip.duration_seconds))+'s':'—'}</strong><span>Duration</span></div>
        <div class="detail-stat"><strong>${fmt(clip.published_count||0)}</strong><span>Published posts</span></div>
      </div>
    </section>

    <section class="detail-section">
      <h4>Campaign</h4>
      <p>${esc(clip.campaign_name||'No campaign')}</p>
      ${clip.hook?`<p class="drawer-hook"><strong>Hook:</strong> ${esc(clip.hook)}</p>`:''}
    </section>

    <section class="detail-section">
      <h4>Performance</h4>
      <div class="detail-grid">
        <div class="detail-stat"><strong>${fmt(p.views)}</strong><span>Views</span></div>
        <div class="detail-stat"><strong>${fmt(p.likes)}</strong><span>Likes</span></div>
        <div class="detail-stat"><strong>${fmt(p.comments)}</strong><span>Comments</span></div>
        <div class="detail-stat"><strong>${fmt(p.shares)}</strong><span>Shares</span></div>
      </div>
    </section>

    <section class="detail-section">
      <h4>Distribution jobs</h4>
      ${distributions.length?distributions.map(d=>`
        <div class="distribution-card">
          <div class="distribution-card-top">
            <strong>${esc(platformLabel(d.platform))} · ${esc(d.account_username||'unassigned')}</strong>
            <span class="status-chip">${esc(d.status||'unknown')}</span>
          </div>
          <small>${d.finished_at?'Finished '+esc(dateShort(d.finished_at)):(d.scheduled_at?'Scheduled '+esc(dateShort(d.scheduled_at)):'No schedule')}</small>
          ${d.url?`<a class="post-url" href="${esc(d.url)}" target="_blank" rel="noopener">Open published post ↗</a>`:''}
        </div>
      `).join(''):'<p>No distribution jobs are attached to this clip yet.</p>'}
    </section>

    ${clip.publishing_approved===false?'<button id="enhanced-drawer-approve" class="primary-inline-btn drawer-approve-full">Approve Publishing</button>':''}
  `;

  const video=$('drawer-body').querySelector('.drawer-video-player');
  seekFallback(video,clip);

  const approve=$('enhanced-drawer-approve');
  if(approve){
    approve.onclick=async()=>{
      approve.disabled=true;
      approve.textContent='Approving…';
      try{
        await api('/api/clips/action',{method:'POST',body:{id:clip.id,action:'approve'}});
        clip.publishing_approved=true;
        approve.textContent='Approved';
        await media.load();
      }catch(error){
        approve.disabled=false;
        approve.textContent='Approve Publishing';
        alert(error.message);
      }
    };
  }

  $('detail-drawer').hidden=false;
}

async function openEnhancedModal(id){
  const clip=findClip(id);
  if(!clip) return;
  if(!clip.render_url&&clip.render_status_url) await recover(clip);
  const source=previewSource(clip);
  if(!source.url){
    openEnhancedDrawer(id);
    return;
  }

  $('video-modal-title').textContent=clip.title||'Clip Preview';
  $('video-modal-subtitle').textContent=source.final
    ? (clip.campaign_name||'Final rendered output')
    : (clip.campaign_name||'Clip')+' · source fallback, not final render';

  const player=$('video-player');
  player.pause();
  player.src=source.url;
  player.load();
  seekFallback(player,clip);

  $('video-modal-meta').innerHTML=`
    <div class="meta-row"><span>Preview</span><strong>${source.final?'Final rendered output':'Source segment fallback'}</strong></div>
    <div class="meta-row"><span>Status</span><strong>${esc(clip.status||'unknown')}</strong></div>
    <div class="meta-row"><span>Publishing</span><strong>${clip.publishing_approved?'Approved':'Needs approval'}</strong></div>
    <div class="meta-row"><span>Duration</span><strong>${clip.duration_seconds?Math.round(Number(clip.duration_seconds))+' seconds':'Unknown'}</strong></div>
  `;
  $('video-modal').hidden=false;
}

function enhanceRows(){
  for(const detail of document.querySelectorAll('.clip-details')){
    const id=detail.dataset.id;
    const clip=findClip(id);
    if(!clip) continue;
    const actionWrap=detail.closest('tr')?.querySelector('.clip-actions');
    if(actionWrap && !actionWrap.querySelector('.enhanced-preview-clip') && (clip.render_url||clip.render_status_url||clip.source_preview_url)){
      const button=document.createElement('button');
      button.type='button';
      button.className='open-btn enhanced-preview-clip';
      button.dataset.id=id;
      button.textContent='Preview';
      actionWrap.prepend(button);
    }
  }
}

document.addEventListener('click',event=>{
  const detail=event.target.closest('.clip-details');
  if(detail){
    event.preventDefault();
    event.stopImmediatePropagation();
    openEnhancedDrawer(detail.dataset.id);
    return;
  }

  const preview=event.target.closest('.preview-clip,.enhanced-preview-clip');
  if(preview){
    event.preventDefault();
    event.stopImmediatePropagation();
    openEnhancedModal(preview.dataset.id);
  }
},true);

const observer=new MutationObserver(enhanceRows);
const boot=setInterval(()=>{
  if(!state.clips) return;
  clearInterval(boot);
  enhanceRows();
  const table=$('clips-table');
  if(table) observer.observe(table,{childList:true,subtree:true});
},250);

window.__alchemicClipReview={openEnhancedDrawer,openEnhancedModal,recover};
