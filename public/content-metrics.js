const media=window.__alchemic;
if(!media) throw new Error('Alchemic core unavailable');

const {state,api}=media;
const $=id=>document.getElementById(id);

let syncing=false;
let lastAttempt=0;
const AUTO_INTERVAL=5*60*1000;

function status(message,tone=''){
  const el=$('content-metrics-status');
  if(!el) return;
  el.textContent=message;
  el.className='metrics-sync-status'+(tone?' '+tone:'');
}

function timeLabel(value){
  if(!value) return 'Never synced';
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) return 'Never synced';
  return 'Updated '+d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
}

async function refreshContentOnly(){
  const content=await api('/api/content');
  state.content=content;
  window.__alchemicContentTable?.render?.();
  window.__alchemicContentChart?.render?.();
  return content;
}

async function sync({force=false,silent=false}={}){
  if(syncing||!state.auth?.accessToken) return;
  const now=Date.now();
  if(!force&&now-lastAttempt<AUTO_INTERVAL) return;

  syncing=true;
  lastAttempt=now;

  const button=$('sync-metrics');
  if(button){
    button.disabled=true;
    button.textContent=force?'Syncing…':'Checking…';
  }
  status('Checking platform metrics…','syncing');

  try{
    const result=await api('/api/metrics/sync',{
      method:'POST',
      body:{
        limit:400,
        maxUpdates:force?250:80,
        force
      }
    });

    const content=await refreshContentOnly();
    const latest=content.summary?.latest_metrics_at||result.refreshed_at;

    if(result.failed){
      status(`Updated ${result.updated||0} · ${result.failed} failed`,'warning');
    }else if(result.updated){
      status(`${result.updated} posts refreshed`,'success');
    }else{
      status(timeLabel(latest),'success');
    }

    if(!silent&&result.failed){
      alert(`Metrics refreshed, but ${result.failed} post${result.failed===1?'':'s'} could not be updated. The working posts were still saved.`);
    }
  }catch(error){
    status('Metrics sync failed','error');
    if(!silent) alert(error.message);
    else console.warn('Automatic metrics sync:',error);
  }finally{
    syncing=false;
    if(button){
      button.disabled=false;
      button.textContent='Sync now';
    }
  }
}

function replaceLegacySyncHandler(){
  const old=$('sync-metrics');
  if(!old) return;
  const button=old.cloneNode(true);
  old.replaceWith(button);
  button.addEventListener('click',()=>sync({force:true,silent:false}));
}

replaceLegacySyncHandler();

document.querySelector('.nav-item[data-view="content"]')?.addEventListener('click',()=>{
  setTimeout(()=>sync({force:false,silent:true}),200);
});

document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&state.view==='content') sync({force:false,silent:true});
});

setInterval(()=>{
  if(document.hidden||!state.auth?.accessToken) return;
  sync({force:false,silent:true});
},AUTO_INTERVAL);

const boot=setInterval(()=>{
  if(!state.auth?.accessToken||!state.content) return;
  clearInterval(boot);
  const latest=state.content.summary?.latest_metrics_at;
  status(latest?timeLabel(latest):'Waiting for first metrics sync');
  setTimeout(()=>sync({force:false,silent:true}),700);
},400);

window.__alchemicContentMetrics={sync,refreshContentOnly};
