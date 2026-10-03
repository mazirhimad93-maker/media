import { eligibilityLabel } from './messaging-policy.js';
const stages = ['new', 'engaged', 'qualified', 'booked', 'client', 'closed'];
const choices = ['new', 'engaged', 'qualified', 'registered', 'booked', 'client', 'not_fit', 'archived'];
const stageFor = (status) => status === 'registered' ? 'qualified' : ['not_fit', 'archived'].includes(status) ? 'closed' : stages.includes(status) ? status : 'new';
let app;
let leadRows = [];
let loading = false;

function renderLeads() {
  if (!app) return;
  const unique = new Map();
  for (const lead of leadRows) {
    const previous = unique.get(lead.contact_id);
    const unread = Number(lead.unread_count || 0);
    if (!previous) unique.set(lead.contact_id, { ...lead, total_unread: unread });
    else {
      const total = previous.total_unread + unread;
      if (!Number(previous.unread_count || 0) && unread) unique.set(lead.contact_id, { ...lead, total_unread: total });
      else previous.total_unread = total;
    }
  }
  const messaging=document.getElementById('lead-messaging-filter').value;
  const followUp=document.getElementById('lead-follow-up-filter').value;
  const notBooked=document.getElementById('lead-not-booked').checked;
  const now=Date.now();
  const rows = [...unique.values()].filter(lead=>{
    const e=lead.messaging_eligibility||{};
    const open=e.state==='NORMAL_DM' && Date.parse(e.expires_at)>now;
    if(messaging==='open' && !open) return false;
    if(messaging==='expiring' && (!open || Date.parse(e.expires_at)-now>4*3600000)) return false;
    if(messaging==='closed' && e.state!=='WAITING_FOR_INBOUND') return false;
    if(messaging==='human' && e.state!=='HUMAN_AGENT') return false;
    if(messaging==='unavailable' && !['UNSUPPORTED','DISCONNECTED'].includes(e.state)) return false;
    if(notBooked && ['booked','client'].includes(lead.lead_status)) return false;
    if(followUp==='due' && (!lead.follow_up || Date.parse(lead.follow_up.due_at)>now)) return false;
    if(followUp==='planned' && !lead.follow_up) return false;
    if(followUp==='30' && (!lead.last_outbound_at || now-Date.parse(lead.last_outbound_at)<30*86400000)) return false;
    return true;
  }).sort((a,b)=>{
    if(messaging==='expiring') return Date.parse(a.messaging_eligibility.expires_at)-Date.parse(b.messaging_eligibility.expires_at);
    if(followUp==='due') return Date.parse(a.follow_up.due_at)-Date.parse(b.follow_up.due_at);
    return 0;
  });
  for (const stage of stages) {
    const cards = rows.filter((lead) => stageFor(lead.lead_status) === stage);
    document.getElementById('lead-' + stage).textContent = String(cards.length);
    const unread = cards.reduce((sum, lead) => sum + lead.total_unread, 0);
    document.querySelector(`#lead-stage-filter option[value="${stage}"]`).textContent =
      stage.charAt(0).toUpperCase() + stage.slice(1) + (unread ? ` · ${unread} unread` : '');
    document.getElementById('lead-cards-' + stage).innerHTML = cards.length ? cards.map((lead) => `
      <article class="lead-card ${lead.total_unread ? 'unread' : ''}" draggable="true" data-id="${app.esc(lead.contact_id)}" data-conversation="${app.esc(lead.conversation_id)}">
        <div class="lead-card-head"><strong>${app.esc(lead.contact_display_name || lead.contact_username || 'Social lead')}</strong><span>${app.esc(app.platformLabel(lead.platform))}</span></div>
        <div class="lead-card-account">@${app.esc(lead.account_username || 'account')}${lead.lead_status === 'registered' ? ' · Registered' : ''}</div>
        ${lead.total_unread ? `<div class="lead-unread"><span class="lead-unread-dot" aria-hidden="true"></span>${lead.total_unread} unread message${lead.total_unread === 1 ? '' : 's'}</div>` : ''}
        <div class="lead-messaging-state" data-state="${app.esc(lead.messaging_eligibility?.state||'UNKNOWN')}">${app.esc(eligibilityLabel(lead.messaging_eligibility))}</div>
        ${lead.follow_up?`<div class="lead-follow-up-date">Follow-up ${Date.parse(lead.follow_up.due_at)<=now?'due':'saved'} · ${app.esc(new Date(lead.follow_up.due_at).toLocaleString())}</div>`:''}
        <p>${app.esc(String(lead.last_message || 'No recent message').slice(0, 110))}</p>
        <div class="lead-card-actions">
          <button class="text-btn lead-open" type="button">Open chat</button>
          <label><span class="sr-only">Move lead to stage</span><select class="lead-move" aria-label="Move ${app.esc(lead.contact_display_name || lead.contact_username || 'lead')} to stage">${choices.map((value) => `<option value="${value}" ${lead.lead_status === value ? 'selected' : ''}>${value.replace('_', ' ')}</option>`).join('')}</select></label>
        </div>
      </article>`).join('') : '<div class="pipeline-empty">No leads here yet</div>';
  }
  applyMobileStage();
}

function applyMobileStage() {
  const selected = document.getElementById('lead-stage-filter').value;
  document.querySelectorAll('#lead-board .pipeline-column').forEach((column) => {
    column.classList.toggle('mobile-hidden', column.dataset.stage !== selected);
  });
}

async function moveLead(contactId, conversationId, status) {
  const lead = leadRows.find((row) => row.contact_id === contactId);
  if (!lead || lead.lead_status === status) return;
  const previous = lead.lead_status;
  leadRows.filter((row) => row.contact_id === contactId).forEach((row) => { row.lead_status = status; });
  renderLeads();
  const message = document.getElementById('leads-message');
  try {
    await app.api('/api/social/lead-status', { method: 'POST', body: { conversationId, status } });
    message.textContent = 'Lead moved to ' + status.replace('_', ' ') + '.';
    message.className = 'connector-message success';
    window.loadAlchemicInbox?.();
  } catch (error) {
    leadRows.filter((row) => row.contact_id === contactId).forEach((row) => { row.lead_status = previous; });
    renderLeads();
    message.textContent = error.message;
    message.className = 'connector-message error';
  }
}

async function loadLeads() {
  if (!app?.state.auth.accessToken || loading) return;
  loading = true;
  const message = document.getElementById('leads-message');
  try {
    const result = await app.api('/api/leads');
    leadRows = result.leads || [];
    renderLeads();
    message.textContent = leadRows.length ? '' : 'New leads will appear here as conversations arrive.';
    message.className = 'connector-message';
  } catch (error) {
    message.textContent = error.message;
    message.className = 'connector-message error';
  } finally {
    loading = false;
  }
}

window.loadAlchemicLeads = loadLeads;
for(const id of ['lead-messaging-filter','lead-follow-up-filter','lead-not-booked']) document.getElementById(id).addEventListener('change',renderLeads);
document.getElementById('lead-stage-filter').addEventListener('change', applyMobileStage);
document.getElementById('lead-board').addEventListener('change', (event) => {
  if (!event.target.matches('.lead-move')) return;
  const card = event.target.closest('.lead-card');
  moveLead(card.dataset.id, card.dataset.conversation, event.target.value);
});
document.getElementById('lead-board').addEventListener('click', (event) => {
  const button = event.target.closest('.lead-open');
  if (!button) return;
  const conversationId = button.closest('.lead-card').dataset.conversation;
  window.openAlchemicConversation?.(conversationId, leadRows.find((row) => row.conversation_id === conversationId));
});
document.getElementById('lead-board').addEventListener('dragstart', (event) => {
  const card = event.target.closest('.lead-card');
  if (!card) return;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', card.dataset.id);
});
document.getElementById('lead-board').addEventListener('dragover', (event) => {
  const column = event.target.closest('.pipeline-column');
  if (!column) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
});
document.getElementById('lead-board').addEventListener('drop', (event) => {
  const column = event.target.closest('.pipeline-column');
  if (!column) return;
  event.preventDefault();
  const id = event.dataTransfer.getData('text/plain');
  const lead = leadRows.find((row) => row.contact_id === id);
  if (lead) moveLead(id, lead.conversation_id, column.dataset.stage === 'closed' ? 'archived' : column.dataset.stage);
});

if (window.__alchemic) { app = window.__alchemic; if (app.state.view === 'leads') loadLeads(); }
else window.addEventListener('alchemic-ready', () => { app = window.__alchemic; if (app.state.view === 'leads') loadLeads(); }, { once: true });
