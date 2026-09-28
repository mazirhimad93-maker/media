const media=window.__alchemic;
if(!media) throw new Error('Alchemic core unavailable');

const {state,fmt,platformLabel}=media;
const $=id=>document.getElementById(id);

const metricLabels={
  views:'Views',
  results:'Results',
  likes:'Likes',
  comments:'Comments',
  shares:'Shares'
};

const ui={metric:'views',mode:'cumulative'};

function currentRows(){
  return window.__alchemicContentTable?.filteredRows?.() || state.content?.rows || [];
}

function filteredPoints(){
  const rows=currentRows();
  const queueIds=new Set(rows.map(x=>x.queue_id));
  return (state.content?.activity_points||state.content?.metric_points||[]).filter(p=>queueIds.has(p.queue_id));
}

function pointValue(point,metric){
  if(metric==='results') return Number(point.link_clicks||0)+Number(point.inbound_dms||0);
  return Number(point[metric]||0);
}

function dayKey(value){
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) return null;
  const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,10);
}

function dailySeries(metric){
  const map=new Map();
  for(const p of filteredPoints()){
    const day=dayKey(p.occurred_at||p.captured_at);
    if(!day) continue;
    map.set(day,(map.get(day)||0)+pointValue(p,metric));
  }

  const days=[...map.keys()].sort();
  if(!days.length) return [];

  const start=new Date(days[0]+'T00:00:00');
  const end=new Date(days[days.length-1]+'T00:00:00');
  const out=[];
  let running=0;
  for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1)){
    const key=d.toISOString().slice(0,10);
    const daily=Number(map.get(key)||0);
    running+=daily;
    out.push({day:key,value:ui.mode==='daily'?daily:running,daily,cumulative:running});
  }
  return out;
}

function compactTick(value){
  const n=Number(value||0);
  if(n>=1_000_000) return (n/1_000_000).toFixed(n>=10_000_000?0:1).replace('.0','')+'M';
  if(n>=1_000) return (n/1_000).toFixed(n>=10_000?0:1).replace('.0','')+'K';
  return String(Math.round(n));
}

function niceMax(value){
  const n=Math.max(1,Number(value||0));
  const power=Math.pow(10,Math.floor(Math.log10(n)));
  const scaled=n/power;
  const nice=scaled<=1?1:scaled<=2?2:scaled<=5?5:10;
  return nice*power;
}

function platformIcon(platform){
  if(platform==='youtube_shorts') return '▶';
  if(platform==='instagram_reels') return '◎';
  if(platform==='facebook_page'||platform==='facebook') return 'f';
  if(platform==='tiktok_video'||platform==='tiktok') return '♪';
  return '•';
}

function renderBreakdown(){
  const host=$('content-platform-breakdown');
  if(!host) return;
  const rows=currentRows().filter(x=>x.status==='done'||x.external_post_id||x.external_post_url);
  const map=new Map();
  for(const row of rows){
    const key=row.platform||'unknown';
    const item=map.get(key)||{platform:key,clips:0,views:0,results:0};
    item.clips++;
    item.views+=Number(row.views||0);
    item.results+=Number(row.primary_result||0);
    map.set(key,item);
  }
  const data=[...map.values()].sort((a,b)=>b.views-a.views);
  const max=Math.max(1,...data.map(x=>x.views));
  const title=$('content-breakdown-title');
  if(title) title.textContent=ui.metric==='results'?'Results by platform':'Views by platform';
  host.innerHTML=data.length?data.map(item=>
    '<div class="analytics-platform-row">'+
      '<div class="analytics-platform-main"><span class="analytics-platform-icon '+item.platform+'">'+platformIcon(item.platform)+'</span><strong>'+platformLabel(item.platform)+'</strong></div>'+
      '<div class="analytics-platform-bar"><span style="width:'+Math.max(2,item.views/max*100)+'%"></span></div>'+
      '<div class="analytics-platform-meta"><span>'+fmt(item.clips)+' clips</span><strong>'+fmt(item.views)+' views</strong><span>'+fmt(item.results)+' results</span></div>'+
    '</div>'
  ).join(''):'<div class="analytics-empty-row">No published content in this range.</div>';
}

function syncVisibleControls(){
  const platform=$('content-platform-filter')?.value||'all';
  document.querySelectorAll('.content-platform-tab').forEach(btn=>btn.classList.toggle('active',btn.dataset.platform===platform));
  const range=$('content-date-filter')?.value||'30';
  if($('content-range-select')) $('content-range-select').value=range==='all'?'all':range;
  document.querySelectorAll('.content-metric-tab').forEach(btn=>btn.classList.toggle('active',btn.dataset.metric===ui.metric));
  document.querySelectorAll('.content-mode-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.mode===ui.mode));
}
function render(){
  const host=$('content-chart');
  if(!host) return;

  const metric=ui.metric;
  const series=dailySeries(metric);
  const rows=currentRows();
  const total=ui.mode==='daily'
    ? series.reduce((n,x)=>n+Number(x.value||0),0)
    : Number(series.at(-1)?.value||0);

  if($('content-chart-total')) $('content-chart-total').textContent=fmt(total);
  if($('content-chart-total-label')) $('content-chart-total-label').textContent=metricLabels[metric]||metric;

  const subtitle=$('content-chart-subtitle');
  if(subtitle){
    subtitle.textContent=series.length
      ? `${ui.mode==='daily'?'Daily':'Cumulative'} ${String(metricLabels[metric]||metric).toLowerCase()} across ${rows.length} matching posts`
      : 'Performance history will appear here as platform metrics are collected.';
  }

  if(!series.length){
    host.innerHTML=`
      <div class="chart-empty">
        <div class="chart-empty-icon">↗</div>
        <strong>No performance history yet</strong>
        <span>Use Sync now to collect current metrics. Historical daily YouTube curves require YouTube Analytics authorization.</span>
      </div>
    `;
    renderBreakdown();
    return;
  }

  const width=Math.max(760,host.clientWidth||900);
  const height=280;
  const pad={left:58,right:22,top:18,bottom:38};
  const innerW=width-pad.left-pad.right;
  const innerH=height-pad.top-pad.bottom;
  const max=niceMax(Math.max(...series.map(x=>x.value),1));
  const count=series.length;

  const x=i=>pad.left+(count===1?innerW/2:(i/(count-1))*innerW);
  const y=v=>pad.top+innerH-(Number(v||0)/max)*innerH;

  const line=series.map((p,i)=>`${i?'L':'M'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const area=`${line} L ${x(count-1).toFixed(1)} ${(pad.top+innerH).toFixed(1)} L ${x(0).toFixed(1)} ${(pad.top+innerH).toFixed(1)} Z`;

  const yTicks=[0,.25,.5,.75,1].map(frac=>{
    const value=max*frac;
    const yy=y(value);
    return `
      <line class="chart-grid-line" x1="${pad.left}" x2="${width-pad.right}" y1="${yy}" y2="${yy}"></line>
      <text class="chart-axis-label chart-y-label" x="${pad.left-10}" y="${yy+3}" text-anchor="end">${compactTick(value)}</text>
    `;
  }).join('');

  const labelIndexes=[0,Math.floor((count-1)/2),count-1].filter((v,i,a)=>a.indexOf(v)===i);
  const xTicks=labelIndexes.map(i=>{
    const date=new Date(series[i].day+'T00:00:00');
    const label=date.toLocaleDateString(undefined,{month:'short',day:'numeric'});
    return `<text class="chart-axis-label" x="${x(i)}" y="${height-11}" text-anchor="${i===0?'start':i===count-1?'end':'middle'}">${label}</text>`;
  }).join('');

  const dots=series.map((p,i)=>`
    <circle class="performance-point" cx="${x(i)}" cy="${y(p.value)}" r="3.2">
      <title>${p.day}: ${fmt(p.value)} ${metricLabels[metric]||metric}</title>
    </circle>
  `).join('');

  host.innerHTML=`
    <svg class="performance-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${metricLabels[metric]||metric} trend">
      <defs>
        <linearGradient id="content-area-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#f97316" stop-opacity=".22"></stop>
          <stop offset="100%" stop-color="#f97316" stop-opacity=".015"></stop>
        </linearGradient>
      </defs>
      ${yTicks}
      ${xTicks}
      <path class="performance-area" d="${area}"></path>
      <path class="performance-line" d="${line}"></path>
      ${dots}
    </svg>
  `;
  renderBreakdown();
}


document.querySelectorAll('.content-platform-tab').forEach(btn=>btn.addEventListener('click',()=>{
  if($('content-platform-filter')) $('content-platform-filter').value=btn.dataset.platform;
  window.__alchemicContentTable?.render?.();
  syncVisibleControls();
}));

$('content-range-select')?.addEventListener('change',()=>{
  if($('content-date-filter')) $('content-date-filter').value=$('content-range-select').value;
  window.__alchemicContentTable?.render?.();
  syncVisibleControls();
});

document.querySelectorAll('.content-metric-tab').forEach(btn=>btn.addEventListener('click',()=>{
  ui.metric=btn.dataset.metric;
  syncVisibleControls();
  render();
}));

document.querySelectorAll('.content-mode-btn').forEach(btn=>btn.addEventListener('click',()=>{
  ui.mode=btn.dataset.mode;
  syncVisibleControls();
  render();
}));

window.addEventListener('alchemic-content-rendered',()=>{syncVisibleControls();render();});
window.addEventListener('resize',()=>{if(state.view==='content') render();});

const wait=setInterval(()=>{
  if(state.content){
    if($('content-date-filter')&&$('content-date-filter').value==='all') $('content-date-filter').value='30';
    syncVisibleControls();
    render();
    clearInterval(wait);
  }
},300);

window.__alchemicContentChart={render};
