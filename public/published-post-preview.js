const media=window.__alchemic;
if(!media) throw new Error('Alchemic core unavailable');

const {esc,fmt,dateShort,platformLabel}=media;
const $=id=>document.getElementById(id);

function youtubeId(row){
  const raw=String(row?.external_post_id||'').trim();
  if(/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  const value=String(row?.external_post_url||raw||'').trim();
  try{
    const u=new URL(value);
    if(u.hostname.includes('youtu.be')) return u.pathname.split('/').filter(Boolean)[0]||raw;
    if(u.searchParams.get('v')) return u.searchParams.get('v');
    const parts=u.pathname.split('/').filter(Boolean);
    const idx=parts.findIndex(x=>x==='shorts'||x==='embed');
    if(idx>=0&&parts[idx+1]) return parts[idx+1];
  }catch{}
  return raw;
}

function instagramEmbed(url){
  if(!url) return null;
  try{
    const u=new URL(url);
    const parts=u.pathname.split('/').filter(Boolean);
    const type=parts[0];
    const code=parts[1];
    if(!['p','reel','tv'].includes(type)||!code) return null;
    return 'https://www.instagram.com/'+type+'/'+code+'/embed/';
  }catch{return null}
}

function tiktokId(row){
  const raw=String(row?.external_post_id||'').trim();
  if(/^\d+$/.test(raw)) return raw;
  const m=String(row?.external_post_url||'').match(/\/video\/(\d+)/);
  return m?.[1]||null;
}

function embedHtml(row){
  const platform=row.platform;
  if(platform==='youtube_shorts'){
    const id=youtubeId(row);
    if(id) return `<iframe class="published-social-frame youtube-frame" src="https://www.youtube.com/embed/${encodeURIComponent(id)}?rel=0" title="${esc(row.title||'YouTube video')}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
  }

  if(platform==='instagram_reels'){
    const src=instagramEmbed(row.external_post_url);
    if(src) return `<iframe class="published-social-frame instagram-frame" src="${esc(src)}" title="${esc(row.title||'Instagram post')}" scrolling="no" allowtransparency="true"></iframe>`;
  }

  if(platform==='facebook_page'||platform==='facebook'){
    if(row.external_post_url){
      const src='https://www.facebook.com/plugins/video.php?href='+encodeURIComponent(row.external_post_url)+'&show_text=false&width=500';
      return `<iframe class="published-social-frame facebook-frame" src="${esc(src)}" title="${esc(row.title||'Facebook post')}" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share" allowfullscreen></iframe>`;
    }
  }

  if(platform==='tiktok_video'||platform==='tiktok'){
    const id=tiktokId(row);
    if(id) return `<iframe class="published-social-frame tiktok-frame" src="https://www.tiktok.com/player/v1/${encodeURIComponent(id)}?&music_info=1&description=1" title="${esc(row.title||'TikTok video')}" allow="fullscreen"></iframe>`;
  }

  return `<div class="published-post-fallback"><strong>Live embed unavailable</strong><span>Open the published post to view it on ${esc(platformLabel(platform))}.</span></div>`;
}

function metric(label,value,detail=''){
  return `<div class="published-kpi"><span>${esc(label)}</span><strong>${typeof value==='number'?fmt(value):esc(value)}</strong>${detail?`<small>${esc(detail)}</small>`:''}</div>`;
}

function open(row){
  if(!row) return;
  $('published-post-title').textContent=row.title||'Published post';
  $('published-post-subtitle').textContent=(platformLabel(row.platform)||row.platform||'')+(row.account_username?' · '+row.account_username:'');
  $('published-post-embed').innerHTML=embedHtml(row);

  $('published-post-kpis').innerHTML=[
    metric('Views',Number(row.views||0)),
    metric(row.primary_result_label||'Result',Number(row.primary_result||0)),
    metric('Link Clicks',Number(row.link_clicks||0)),
    metric('DMs',Number(row.inbound_dms||0)),
    metric('DM Threads',Number(row.dm_threads||0)),
    metric('Comments',Number(row.comments||0)),
    metric('Engagement Rate',Number(row.engagement_rate||0).toFixed(2)+'%'),
    metric('Engagements',Number(row.engagements||0))
  ].join('');

  $('published-post-campaign').textContent=row.campaign_name||'—';
  $('published-post-account').textContent=row.account_username||'—';
  $('published-post-date').textContent=dateShort(row.finished_at||row.created_at);
  $('published-post-updated').textContent=row.metrics_captured_at?dateShort(row.metrics_captured_at):'Not synced';

  const link=$('published-post-link');
  if(row.external_post_url){
    link.href=row.external_post_url;
    link.hidden=false;
  }else{
    link.hidden=true;
    link.removeAttribute('href');
  }

  $('published-post-modal').hidden=false;
  document.body.classList.add('modal-open');
}

function close(){
  const modal=$('published-post-modal');
  if(!modal) return;
  modal.hidden=true;
  $('published-post-embed').innerHTML='';
  document.body.classList.remove('modal-open');
}

window.addEventListener('alchemic-open-published-post',event=>open(event.detail?.row));
document.querySelectorAll('[data-close-published-post]').forEach(el=>el.addEventListener('click',close));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('published-post-modal')?.hidden) close()});
