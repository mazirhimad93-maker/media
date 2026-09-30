const media=window.__alchemic;
if(!media) throw new Error('Alchemic core unavailable');
const {api,esc}=media;

function card(){
  const host=document.querySelector('#view-settings .settings-grid');
  if(!host||document.getElementById('comment-automation-card')) return;
  host.insertAdjacentHTML('beforeend',`
    <article class="card settings-card" id="comment-automation-card">
      <div class="card-head"><div><h2>Comment → DM</h2><p>Turn Instagram keyword comments into one automatic private reply.</p></div></div>
      <form id="comment-automation-form" class="settings-form">
        <label><span>Keyword</span><input id="comment-auto-keyword" placeholder="TRAINING" maxlength="80" required></label>
        <label><span>Match</span><select id="comment-auto-match"><option value="exact">Exact comment</option><option value="contains">Contains keyword</option><option value="starts_with">Starts with keyword</option></select></label>
        <label><span>Instagram account</span><select id="comment-auto-account"><option value="">All connected Instagram accounts</option></select></label>
        <label><span>Private reply</span><textarea id="comment-auto-reply" rows="4" maxlength="1000" placeholder="Hey — saw you commented TRAINING. I’ve got you. Are you currently selling a service?" required></textarea></label>
        <label class="rights-check"><input id="comment-auto-active" type="checkbox" checked><span>Active immediately</span></label>
        <button class="primary-inline-btn" type="submit">Add automation</button>
      </form>
      <div id="comment-auto-message" class="connector-message"></div>
      <div id="comment-auto-list" style="margin-top:14px"></div>
      <p class="settings-note">Meta allows one private reply per comment. After the person replies, the conversation continues in Unified Inbox.</p>
    </article>
  `);
}

function message(text,tone=''){
  const el=document.getElementById('comment-auto-message');
  if(!el) return;
  el.textContent=text||'';
  el.className='connector-message'+(tone?' '+tone:'');
}

async function load(){
  card();
  const list=document.getElementById('comment-auto-list');
  if(!list) return;
  try{
    const data=await api('/api/comment-automations');
    const account=document.getElementById('comment-auto-account');
    if(account){
      const current=account.value;
      account.innerHTML='<option value="">All connected Instagram accounts</option>'+
        (data.accounts||[]).map(a=>`<option value="${esc(a.id)}">@${esc(a.username||a.display_name||'Instagram')}</option>`).join('');
      account.value=current;
    }
    list.innerHTML=(data.automations||[]).length
      ? data.automations.map(rule=>`
        <div class="security-row" data-comment-rule="${esc(rule.id)}">
          <span><strong>${esc(rule.keyword)}</strong> <small>· ${esc(rule.match_type)}</small><br><small>${esc(rule.reply_body)}</small></span>
          <span style="display:flex;gap:8px;align-items:center">
            <button type="button" class="secondary-btn" data-toggle-rule="${esc(rule.id)}" data-active="${rule.is_active?'1':'0'}">${rule.is_active?'Pause':'Activate'}</button>
            <button type="button" class="secondary-btn" data-delete-rule="${esc(rule.id)}">Delete</button>
          </span>
        </div>`).join('')
      : '<div class="empty-row">No comment automations yet.</div>';
  }catch(error){
    message(error.message,'error');
  }
}

document.addEventListener('submit',async event=>{
  if(event.target?.id!=='comment-automation-form') return;
  event.preventDefault();
  message('Saving…');
  try{
    await api('/api/comment-automations',{method:'POST',body:{
      keyword:document.getElementById('comment-auto-keyword').value,
      matchType:document.getElementById('comment-auto-match').value,
      accountId:document.getElementById('comment-auto-account').value||null,
      replyBody:document.getElementById('comment-auto-reply').value,
      isActive:document.getElementById('comment-auto-active').checked
    }});
    event.target.reset();
    document.getElementById('comment-auto-active').checked=true;
    message('Automation saved.','success');
    await load();
  }catch(error){message(error.message,'error');}
});

document.addEventListener('click',async event=>{
  const toggle=event.target.closest?.('[data-toggle-rule]');
  const del=event.target.closest?.('[data-delete-rule]');
  try{
    if(toggle){
      await api('/api/comment-automations',{method:'PATCH',body:{id:toggle.dataset.toggleRule,isActive:toggle.dataset.active!=='1'}});
      await load();
    }else if(del){
      await api('/api/comment-automations?id='+encodeURIComponent(del.dataset.deleteRule),{method:'DELETE'});
      await load();
    }
  }catch(error){message(error.message,'error');}
});

document.querySelector('.nav-item[data-view="settings"]')?.addEventListener('click',()=>setTimeout(load,100));
const boot=setInterval(()=>{
  if(!media.state?.auth?.accessToken) return;
  clearInterval(boot);
  card();
},400);
