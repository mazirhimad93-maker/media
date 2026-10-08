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
const DAY=86400000;

function currentRows(){
  return window.__alchemicContentTable?.filteredRows?.() || state.content?.rows || [];
}

function filteredPoints(){
  const rows=currentRows();
  const queueIds=new Set(rows.map(x=>x.queue_id));
  return (state.content?.activity_points||state.content?.metric_points||[])
    .filter(p=>queueIds.has(p.queue_id));
}

function pointValue(point,metric){
  if(metric==='results') return Number(point.link_clicks||0)+Number(point.inbound_dms||0);
  return Number(point[metric]||0);
}

function rowValue(row,metric){
  if(metric==='results') return Number(row.link_clicks||0)+Number(row.inbound_dms||0);
  const value=row?.[metric];
  return value===null||value===undefined?0:Number(value||0);
}

function currentMetricTotal(metric){
  return currentRows().reduce((sum,row)=>sum+rowValue(row,metric),0);
}

function dayKey(value){
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) return null;
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,'0');
  const day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function dateFromKey(key){
  const [y,m,d]=String(key).split('-').map(Number);
  return new Date(y,m-1,d,0,0,0,0);
}

function todayStart(){
  const d=new Date();
  return new Date(d.getFullYear(),d.getMonth(),d.getDate(),0,0,0,0);
}

function rangeBounds(rows,points){
  const selected=$('content-date-filter')?.value||'30';
  const end=todayStart();

  if(selected!=='all'){
    const days=Math.max(1,Number(selected||30));
    return {start:new Date(end.getTime()-(days-1)*DAY),end};
  }

  const candidates=[];
  for(const row of rows){
    const d=new Date(row.finished_at||row.created_at||0);
    if(!Number.isNaN(d.getTime())&&d.getTime()>0) candidates.push(new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime());
  }
  for(const point of points){
    const d=new Date(point.occurred_at||point.captured_at||0);
    if(!Number.isNaN(d.getTime())&&d.getTime()>0) candidates.push(new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime());
  }

  const start=candidates.length?new Date(Math.min(...candidates)):new Date(end);
  return {start,end};
}

function buildSeries(metric){
  const rows=currentRows();
  const points=filteredPoints();
  const bounds=rangeBounds(rows,points);
  const map=new Map();

  // Only positive activity changes are needed here. Zero-valued DM/click events
  // must not create a fake flat "0 views" history for an otherwise measured post.
  for(const point of points){
    const value=pointValue(point,metric);
    if(!(value>0)) continue;
    const key=dayKey(point.occurred_at||point.captured_at);
    if(!key) continue;
    const d=dateFromKey(key);
    if(d<bounds.start||d>bounds.end) continue;
    map.set(key,(map.get(key)||0)+value);
  }

  const knownTotal=[...map.values()].reduce((sum,value)=>sum+Number(value||0),0);
  const currentTotal=currentMetricTotal(metric);

  // A lifetime balance is not activity gained inside the selected dates.
  // Plot only provider daily counts or increases observed after a baseline.
  const targetTotal=knownTotal;

  const out=[];
  let running=0;
  for(let d=new Date(bounds.start);d<=bounds.end;d=new Date(d.getTime()+DAY)){
    const key=dayKey(d);
    const daily=Number(map.get(key)||0);
    running+=daily;
    out.push({
      day:key,
      daily,
      cumulative:running,
      value:ui.mode==='daily'?daily:running
    });
  }

  return {series:out,total:targetTotal,knownTotal,currentTotal,bounds,rows};
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
    item.results+=Number(row.link_clicks||0)+Number(row.inbound_dms||0);
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

function labelDate(key,includeYear=false){
  const date=dateFromKey(key);
  return date.toLocaleDateString(undefined,includeYear
    ? {month:'short',day:'numeric',year:'numeric'}
    : {month:'short',day:'numeric'});
}

function bindHover(host,series,{width,height,pad,x,y,metric}){
  const svg=host.querySelector('.performance-svg');
  const hover=host.querySelector('.chart-hover');
  if(!svg||!hover||!series.length) return;

  const line=hover.querySelector('.chart-hover-line');
  const dot=hover.querySelector('.chart-hover-dot');
  const box=hover.querySelector('.chart-tooltip-bg');
  const dateText=hover.querySelector('.chart-tooltip-date');
  const valueText=hover.querySelector('.chart-tooltip-value');
  const boxW=126;
  const boxH=49;

  const showAt=index=>{
    const point=series[index];
    const xx=x(index),yy=y(point.value);
    let boxX=xx+11;
    if(boxX+boxW>width-pad.right) boxX=xx-boxW-11;
    const boxY=Math.max(pad.top,Math.min(height-pad.bottom-boxH,yy-boxH/2));

    line.setAttribute('x1',xx); line.setAttribute('x2',xx);
    line.setAttribute('y1',pad.top); line.setAttribute('y2',pad.top+(height-pad.top-pad.bottom));
    dot.setAttribute('cx',xx); dot.setAttribute('cy',yy);
    box.setAttribute('x',boxX); box.setAttribute('y',boxY);
    dateText.setAttribute('x',boxX+10); dateText.setAttribute('y',boxY+18);
    valueText.setAttribute('x',boxX+10); valueText.setAttribute('y',boxY+36);
    dateText.textContent=labelDate(point.day,true);
    valueText.textContent=`${fmt(point.value)} ${metricLabels[metric]||metric}`;
    hover.setAttribute('opacity','1');
  };

  svg.addEventListener('pointermove',event=>{
    const rect=svg.getBoundingClientRect();
    if(!rect.width) return;
    const viewX=(event.clientX-rect.left)/rect.width*width;
    const ratio=Math.max(0,Math.min(1,(viewX-pad.left)/(width-pad.left-pad.right)));
    const index=series.length===1?0:Math.round(ratio*(series.length-1));
    showAt(index);
  });
  svg.addEventListener('pointerleave',()=>hover.setAttribute('opacity','0'));
}

function render(){
  const host=$('content-chart');
  if(!host) return;

  const metric=ui.metric;
  const built=buildSeries(metric);
  const series=built.series;
  const rows=built.rows;
  const total=built.total;

  if($('content-chart-total')) $('content-chart-total').textContent=fmt(total);
  if($('content-chart-total-label')) $('content-chart-total-label').textContent=metricLabels[metric]||metric;

  const subtitle=$('content-chart-subtitle');
  if(subtitle){
    subtitle.textContent=rows.length
      ? `${ui.mode==='daily'?'Daily':'Cumulative'} ${metric==='results'?'results':'recorded growth'} across ${rows.length} matching posts${metric==='results'?'':'. Cards show current lifetime totals; the chart shows provider daily data or measured increases after the first snapshot.'}`
      : 'Performance history will appear here as platform metrics are collected.';
  }

  if(!rows.length){
    host.innerHTML=`
      <div class="chart-empty">
        <div class="chart-empty-icon">↗</div>
        <strong>No published content in this range</strong>
        <span>Change the date, platform or campaign filters to see performance.</span>
      </div>
    `;
    renderBreakdown();
    return;
  }

  const hasMeasuredMetric=metric==='results'
    ? true
    : rows.some(row=>row.metrics_available||row[metric]!==null&&row[metric]!==undefined);

  if(!hasMeasuredMetric&&total===0){
    host.innerHTML=`
      <div class="chart-empty">
        <div class="chart-empty-icon">↗</div>
        <strong>Waiting for the first metrics snapshot</strong>
        <span>Platform performance will appear here automatically after the first scheduled metrics check.</span>
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
  const max=niceMax(Math.max(...series.map(item=>item.value),total,1));
  const count=series.length;

  const x=index=>pad.left+(count===1?innerW/2:(index/(count-1))*innerW);
  const y=value=>pad.top+innerH-(Number(value||0)/max)*innerH;

  const line=series.map((point,index)=>`${index?'L':'M'} ${x(index).toFixed(1)} ${y(point.value).toFixed(1)}`).join(' ');
  const area=`${line} L ${x(count-1).toFixed(1)} ${(pad.top+innerH).toFixed(1)} L ${x(0).toFixed(1)} ${(pad.top+innerH).toFixed(1)} Z`;

  const yTicks=[0,.25,.5,.75,1].map(frac=>{
    const value=max*frac;
    const yy=y(value);
    return `
      <line class="chart-grid-line" x1="${pad.left}" x2="${width-pad.right}" y1="${yy}" y2="${yy}"></line>
      <text class="chart-axis-label chart-y-label" x="${pad.left-10}" y="${yy+3}" text-anchor="end">${compactTick(value)}</text>
    `;
  }).join('');

  const desiredTicks=width<850?3:5;
  const labelIndexes=[];
  for(let i=0;i<desiredTicks;i++){
    const index=Math.round((count-1)*(i/(desiredTicks-1||1)));
    if(!labelIndexes.includes(index)) labelIndexes.push(index);
  }
  const xTicks=labelIndexes.map(index=>{
    const label=labelDate(series[index].day);
    return `<text class="chart-axis-label" x="${x(index)}" y="${height-11}" text-anchor="${index===0?'start':index===count-1?'end':'middle'}">${label}</text>`;
  }).join('');

  const lastIndex=Math.max(0,count-1);

  host.innerHTML=`
    <svg class="performance-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${metricLabels[metric]||metric} trend">
      <defs>
        <linearGradient id="content-area-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#f97316" stop-opacity=".24"></stop>
          <stop offset="55%" stop-color="#f97316" stop-opacity=".09"></stop>
          <stop offset="100%" stop-color="#f97316" stop-opacity=".01"></stop>
        </linearGradient>
      </defs>
      ${yTicks}
      ${xTicks}
      <path class="performance-area" d="${area}"></path>
      <path class="performance-line" d="${line}"></path>
      <circle class="performance-endpoint" cx="${x(lastIndex)}" cy="${y(series[lastIndex]?.value||0)}" r="3.2"></circle>
      <g class="chart-hover" opacity="0" pointer-events="none">
        <line class="chart-hover-line"></line>
        <circle class="chart-hover-dot" r="4"></circle>
        <rect class="chart-tooltip-bg" width="126" height="49" rx="8"></rect>
        <text class="chart-tooltip-date"></text>
        <text class="chart-tooltip-value"></text>
      </g>
    </svg>
  `;

  bindHover(host,series,{width,height,pad,x,y,metric});
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
