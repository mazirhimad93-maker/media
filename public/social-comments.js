const app=window.__alchemic;
const $=id=>document.getElementById(id);
const esc=value=>app.esc(value);
const key=c=>c.account_id+':'+c.id;
let accounts=[],comments=[],selected=new Set(),cursors=new Map(),busy=false,review=null,loaded=false;
let activityCursor=null,activityPosts=[],activityBusy=false,activityOwner='',lastCommentsSync=0;
const fmt=value=>value==null?'Unavailable':new Intl.NumberFormat().format(value);
const safeUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'?u.href:'#';}catch{return '#';}};

function filteredComments(){
  const account=$('comments-account-filter').value,status=$('comments-status-filter').value;
  const search=$('comments-search').value.trim().toLowerCase();
  return comments.filter(c=>(account==='all'||c.account_id===account) && (status==='all'||status==='unread'&&c.unread||status==='unreplied'&&!c.replied||status==='replied'&&c.replied) && (!search||(c.author+' '+c.text).toLowerCase().includes(search))).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
}
function render(){
  const rows=filteredComments();
  $('comments-unread-count').textContent=String(comments.filter(c=>c.unread).length);
  $('comments-unread-count').title='Unread comments loaded from your channels';
  $('comments-selected-count').textContent=selected.size+' selected';
  $('comments-select-all').checked=rows.length>0&&rows.every(c=>selected.has(key(c)));
  $('comments-more').hidden=!accounts.some(a=>($('comments-account-filter').value==='all'||a.id===$('comments-account-filter').value)&&cursors.get(a.id));
  $('comments-list').innerHTML=rows.length?rows.map(c=>{
    const account=accounts.find(a=>a.id===c.account_id);
    const eligible=c.can_reply&&!c.replied&&account?.comments_write;
    const state=c.reply?.status==='unknown'||c.reply?.status==='sending'?'Check native thread before retrying':c.replied?'Replied':!account?.comments_write?'Reconnect channel for replies':c.unread?'New comment':'Needs reply';
    return `<article class="comment-card ${c.unread?'unread':''}"><div class="comment-card-head"><label><input type="checkbox" data-comment-key="${esc(key(c))}" ${selected.has(key(c))?'checked':''}> <strong>${esc(c.author)}</strong></label><span>${esc(state)}</span></div><div class="comment-meta">${esc(app.platformLabel(c.platform))} · ${esc(account?.username || '')} · ${esc(c.at?new Date(c.at).toLocaleString():'')}</div><p>${esc(c.text)}</p>${c.reply?.error?`<div class="composer-error">${esc(c.reply.error)}</div>`:''}<div class="comment-actions"><a href="${esc(safeUrl(c.url))}" target="_blank" rel="noopener">Open post</a>${eligible?`<button type="button" class="text-btn comment-reply-one" data-key="${esc(key(c))}">Reply</button>`:''}${!account?.comments_write?`<button type="button" class="text-btn comment-reconnect" data-account="${esc(c.account_id)}">Reconnect</button>`:''}</div></article>`;
  }).join(''):'<div class="empty-list">No comments in this view. Sync comments or choose another filter.</div>';
}
async function loadAccounts(){
  const session=app.state.auth?.workspace?.id || app.state.auth?.user?.id;
  const result=await app.api('/api/channels/activity');
  if(session!==(app.state.auth?.workspace?.id || app.state.auth?.user?.id))return;
  accounts=result.accounts || [];
  for(const id of ['comments-account-filter','activity-channel']){
    const current=$(id).value;
    $(id).innerHTML=(id==='comments-account-filter'?'<option value="all">All connected channels</option>':'<option value="">Choose a channel</option>')+accounts.map(a=>`<option value="${esc(a.id)}">${esc(app.platformLabel(a.platform)+' · '+a.username)}</option>`).join('');
    if(accounts.some(a=>a.id===current)||current==='all') $(id).value=current;
  }
  if(!$('activity-channel').value&&accounts.length) $('activity-channel').value=accounts[0].id;
}
async function syncComments(force=false,more=false){
  if(busy||!app.state.auth?.accessToken)return;
  const session=app.state.auth?.workspace?.id || app.state.auth?.user?.id;
  busy=true;lastCommentsSync=Date.now();$('comments-sync').disabled=true;$('comments-more').disabled=true;
  $('comments-status').textContent='Pulling comments from your channels…';
  let errors=[];
  try{
    if(!loaded)await loadAccounts();
    const chosen=$('comments-account-filter').value;
    for(const account of accounts.filter(a=>chosen==='all'||a.id===chosen)){
      const cursor=more?cursors.get(account.id):null;
      if(more&&!cursor)continue;
      try{
        const result=await app.api('/api/social/comments?'+new URLSearchParams({accountId:account.id,...(force?{force:'true'}:{}),...(cursor?{cursor}:{})}));
        if(session!==(app.state.auth?.workspace?.id || app.state.auth?.user?.id))return;
        cursors.set(account.id,result.next_cursor || null);
        const map=new Map(comments.map(c=>[key(c),c]));
        for(const c of result.comments || [])map.set(key(c),c);
        comments=[...map.values()];
        if(result.account)Object.assign(account,result.account);
      }catch(error){errors.push(account.username+': '+error.message);}
      render();
    }
    loaded=true;
    $('comments-status').textContent=errors.length?errors.join(' · '):accounts.length?`Synced ${comments.length} comments · ${new Date().toLocaleTimeString()}. Load older comments to continue through channel history.`:'Connect Instagram or YouTube in Channels to see comments.';
  }catch(error){$('comments-status').textContent=error.message;}
  finally{busy=false;$('comments-sync').disabled=false;$('comments-more').disabled=false;render();}
}
function switchTab(name){
  const commentTab=name==='comments';
  $('inbox-comments-panel').hidden=!commentTab;$('inbox-messages-panel').hidden=commentTab;$('refresh-inbox').hidden=commentTab;
  for(const section of ['messages','comments']){
    const active=section===name;const button=$('inbox-'+section+'-tab');button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));
  }
  if(commentTab)syncComments();
}
function eligibleSelection(){
  return comments.filter(c=>selected.has(key(c))&&!c.replied&&c.can_reply&&accounts.find(a=>a.id===c.account_id)?.comments_write&&!['unknown','sending'].includes(c.reply?.status));
}
$('inbox-messages-tab').onclick=()=>switchTab('messages');
$('inbox-comments-tab').onclick=()=>switchTab('comments');
$('comments-sync').onclick=()=>syncComments(true);
$('comments-more').onclick=()=>syncComments(false,true);
for(const id of ['comments-account-filter','comments-status-filter'])$(id).onchange=render;
$('comments-search').oninput=render;
$('comments-select-all').onchange=event=>{for(const c of filteredComments())event.target.checked?selected.add(key(c)):selected.delete(key(c));render();};
$('comments-list').onchange=event=>{const k=event.target.dataset.commentKey;if(k){event.target.checked?selected.add(k):selected.delete(k);render();}};
$('comments-list').onclick=event=>{
  const reply=event.target.closest('.comment-reply-one');
  if(reply){selected=new Set([reply.dataset.key]);render();$('comments-reply-text').focus();$('comments-reply-form').scrollIntoView({block:'nearest',behavior:'smooth'});}
  const reconnect=event.target.closest('.comment-reconnect');if(reconnect)window.connectAlchemicChannel?.(reconnect.dataset.account);
};
$('comments-mark-read').onclick=async()=>{
  if(busy)return;busy=true;
  try{
    for(const account of accounts){
      const ids=comments.filter(c=>selected.has(key(c))&&c.account_id===account.id).map(c=>c.id);
      for(let i=0;i<ids.length;i+=20)await app.api('/api/social/comments',{method:'PATCH',body:{accountId:account.id,commentIds:ids.slice(i,i+20)}});
      comments.filter(c=>selected.has(key(c))&&c.account_id===account.id).forEach(c=>c.unread=false);
    }
  }catch(error){$('comments-status').textContent=error.message;}finally{busy=false;render();}
};
$('comments-reply-form').onsubmit=event=>{
  event.preventDefault();if(busy)return;
  const targets=eligibleSelection(),text=$('comments-reply-text').value.trim();
  if(!targets.length){$('comments-status').textContent='Select a comment that needs a reply. Reconnect the channel if reply permission is missing.';return;}
  if(targets.length>20){$('comments-status').textContent='Choose up to 20 comments for each batch.';return;}
  review={targets:targets.map(c=>({...c})),text};
  $('comments-review-targets').innerHTML=`<p>${targets.length} public repl${targets.length===1?'y':'ies'} will be posted:</p>`+targets.map(c=>`<p><strong>${esc(c.author)}</strong> · ${esc(accounts.find(a=>a.id===c.account_id)?.username)}<br>${esc(c.text)}</p>`).join('');
  $('comments-review-message').textContent=text;$('comments-review-panel').hidden=false;
  $('comments-review-panel').scrollIntoView({block:'nearest',behavior:'smooth'});
};
$('comments-cancel').onclick=()=>{review=null;$('comments-review-panel').hidden=true;};
$('comments-send').onclick=async()=>{
  if(!review||busy)return;busy=true;$('comments-send').disabled=true;const batch=review;let sent=0,failures=[];
  try{
    for(let i=0;i<batch.targets.length;i++){
      const target=batch.targets[i];$('comments-status').textContent=`Sending ${i+1} of ${batch.targets.length}…`;
      try{
        const result=await app.api('/api/social/comments',{method:'POST',body:{accountId:target.account_id,commentIds:[target.id],text:batch.text}});
        const outcome=result.results?.[0];const live=comments.find(c=>key(c)===key(target));
        if(live)live.reply=outcome;
        if(outcome?.status==='sent'){if(!outcome.duplicate)sent++;if(live){live.replied=true;live.unread=false;}selected.delete(key(target));}
        else failures.push(target.author+': '+(outcome?.error || outcome?.status || 'Delivery not confirmed'));
      }catch(error){failures.push(target.author+': '+error.message);}
      render();
    }
    $('comments-status').textContent=`${sent} replies sent.`+(failures.length?' '+failures.join(' · '):'');
    if(!failures.length)$('comments-reply-text').value='';
  }finally{busy=false;review=null;$('comments-review-panel').hidden=true;$('comments-send').disabled=false;}
};

function renderActivity(){
  $('activity-posts').innerHTML=activityPosts.map(p=>`<article class="activity-post"><a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">${p.thumbnail?`<img loading="lazy" alt="" src="${esc(safeUrl(p.thumbnail))}">`:''}<strong>${esc(p.title.slice(0,180))}</strong></a><div>${esc(p.published_at?new Date(p.published_at).toLocaleString():'')}</div><div class="activity-counts"><span><strong>${fmt(p.views)}</strong> views</span><span><strong>${fmt(p.likes)}</strong> likes</span><span><strong>${fmt(p.comments)}</strong> comments</span></div>${p.metrics_error?`<p>${esc(p.metrics_error)}</p>`:''}</article>`).join('') || '<div class="empty-list">No posts returned for this channel.</div>';
  $('activity-more').hidden=!activityCursor;
}
async function refreshActivity(force=false,more=false){
  if(activityBusy||!app.state.auth?.accessToken)return;
  const session=app.state.auth?.workspace?.id || app.state.auth?.user?.id;
  activityBusy=true;$('activity-refresh').disabled=true;$('activity-more').disabled=true;
  try{
    if(!accounts.length)await loadAccounts();
    const id=$('activity-channel').value;if(!id){$('activity-status').textContent='Connect a channel to see its live posts.';return;}
    if(id!==activityOwner){activityPosts=[];activityCursor=null;activityOwner=id;}
    const result=await app.api('/api/channels/activity?'+new URLSearchParams({accountId:id,...(force?{force:'true'}:{}),...(more&&activityCursor?{cursor:activityCursor}:{})}));
    if($('activity-channel').value!==id || session!==(app.state.auth?.workspace?.id || app.state.auth?.user?.id))return;
    activityPosts=more?[...new Map([...activityPosts,...result.posts].map(p=>[p.id,p])).values()]:result.posts || [];
    activityCursor=result.next_cursor;
    $('activity-status').textContent='Updated '+new Date(result.synced_at).toLocaleString()+' · '+result.coverage;renderActivity();
  }catch(error){$('activity-status').textContent=error.message;}
  finally{activityBusy=false;$('activity-refresh').disabled=false;$('activity-more').disabled=false;}
}
$('activity-refresh').onclick=()=>refreshActivity(true);
$('activity-more').onclick=()=>refreshActivity(false,true);
$('activity-channel').onchange=()=>refreshActivity();
window.__alchemicChannelActivity={refresh:refreshActivity};
document.querySelector('.nav-item[data-view="content"]')?.addEventListener('click',()=>refreshActivity());
document.querySelector('.nav-item[data-view="inbox"]')?.addEventListener('click',()=>syncComments());
setInterval(()=>{if(!document.hidden&&app.state.view==='inbox'&&Date.now()-lastCommentsSync>5*60000)syncComments();},30000);
let sessionWorkspace=null;
setInterval(async()=>{
  const workspace=app.state.auth?.workspace?.id || app.state.auth?.workspaceId || app.state.auth?.user?.id;
  if(!app.state.auth?.accessToken){sessionWorkspace=null;return;}
  if(workspace===sessionWorkspace)return;
  sessionWorkspace=workspace;
  accounts=[];comments=[];cursors.clear();selected.clear();loaded=false;activityPosts=[];activityOwner='';render();
  try{
    await loadAccounts();
    // Remove obsolete saved follow-up metadata once a signed-in workspace is
    // available. This route never creates an outbox job or touches message text.
    for(let page=0;page<20;page++){
      const cleanup=await app.api('/api/social/follow-up',{method:'POST',body:{action:'removeSavedFollowUps'}});
      if(!cleanup.more || !cleanup.removed)break;
    }
    if(app.state.view==='content')refreshActivity();
    if(app.state.view==='inbox')syncComments();
  }catch(error){$('comments-status').textContent=error.message;}
},1000);
