import { jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest } from './_shared.mjs';

const safe=async path=>supabaseRequest(path).catch(()=>[]);
const obj=v=>{
  if(v && typeof v==='object' && !Array.isArray(v)) return v;
  if(typeof v==='string'){ try{return JSON.parse(v)}catch{} }
  return {};
};
const minutes=(a,b)=>Math.max(0,(new Date(b).getTime()-new Date(a).getTime())/60000);
const median=values=>{
  const a=values.filter(Number.isFinite).filter(x=>x>0).sort((x,y)=>x-y);
  if(!a.length) return null;
  const m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
};
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const publicMediaUrl=value=>{
  const s=String(value||'').trim();
  if(!s) return null;
  const match=s.match(/^https?:\/\/(?:54\.172\.230\.194|172\.31\.45\.144|127\.0\.0\.1):8091\/outputs\/([^?#]+)(?:[?#].*)?$/i);
  if(!match) return s;
  return '/media/'+encodeURIComponent(decodeURIComponent(match[1]));
};

function sourceBase(source){
  const s=String(source.status||'').toLowerCase();
  if(['ingest_failed','analysis_failed','failed','ingest_dead_letter'].includes(s)) return {stage:'failed',label:'Failed',progress:100,error:true,eta:null};
  if(s==='pending_ingest') return {stage:'queued',label:'Queued for ingestion',progress:5,eta:12};
  if(s==='ingesting') return {stage:'ingesting',label:'Downloading / caching source',progress:15,eta:8};
  if(s==='ready') return {stage:'ready',label:'Ready for analysis',progress:25,eta:10};
  if(s==='analyzing') return {stage:'analyzing',label:'Transcribing & analyzing',progress:42,eta:10};
  if(s==='analysis_ready') return {stage:'analysis_ready',label:'Analysis complete',progress:55,eta:6};
  if(s==='awaiting_ai_selection') return {stage:'selection',label:'Waiting for moment selection',progress:58,eta:null,waiting:true};
  if(s==='analyzed') return {stage:'planning',label:'Planning clips',progress:64,eta:5};
  return {stage:s||'queued',label:s||'Queued',progress:5,eta:12};
}

function jobFrom(source,variants,renderMedian){
  const base=sourceBase(source);
  const now=Date.now();
  const v=variants||[];
  const approved=v.filter(x=>x.status==='approved');
  const rendering=v.filter(x=>x.status==='rendering');
  const planned=v.filter(x=>x.status==='planned');
  const failed=v.filter(x=>['failed','render_failed','rejected'].includes(String(x.status||'')));
  let stage=base.stage,label=base.label,progress=base.progress,eta=base.eta,waiting=base.waiting||false,error=base.error||false;

  if(v.length){
    if(approved.length===v.length){
      stage='complete'; label='Clips ready'; progress=100; eta=0; waiting=false;
    }else if(rendering.length){
      const current=rendering[0];
      const started=new Date(current.updated_at||current.created_at||Date.now()).getTime();
      const elapsed=Math.max(0,(now-started)/60000);
      const one=Math.max(2,renderMedian||8);
      const currentProgress=clamp(elapsed/one,0,.92);
      progress=Math.round(72 + currentProgress*22);
      const currentRemaining=Math.max(1,one-elapsed);
      eta=Math.ceil(currentRemaining + planned.length*one);
      stage='rendering';
      label=`Rendering ${approved.length+1} of ${v.length}`;
      waiting=false;
    }else if(planned.length){
      stage='planned';
      label=`Render queue: ${planned.length} clip${planned.length===1?'':'s'}`;
      progress=70;
      eta=Math.ceil(planned.length*Math.max(2,renderMedian||8));
      waiting=false;
    }else if(failed.length && approved.length+failed.length===v.length){
      stage='failed'; label='Render failed'; progress=100; eta=null; error=true;
    }
  }

  const updatedAt=source.updated_at||source.created_at||null;
  const elapsedMinutes=updatedAt?Math.max(0,Math.round((now-new Date(updatedAt).getTime())/60000)):0;
  const metadata=obj(source.metadata);

  return {
    source_id:source.id,
    campaign_id:source.campaign_id,
    title:source.title||'Untitled source',
    source_status:source.status,
    source_type:source.source_type,
    operation_mode:source.operation_mode,
    preset_slug:source.clip_preset_slug||metadata?.editing_request?.preset_slug||null,
    preset_version:source.clip_preset_version||metadata?.editing_request?.preset_version||null,
    selector_mode:metadata.selector_mode||metadata?.editing_request?.selector_mode||null,
    stage,
    stage_label:label,
    progress,
    eta_minutes:eta,
    waiting,
    error,
    error_message:source.error_message||null,
    elapsed_minutes:elapsedMinutes,
    updated_at:updatedAt,
    created_at:source.created_at,
    ingest_provider:metadata.ingest_provider||null,
    expected_clips:Number(
      metadata.expected_render_count
      || metadata?.editing_request?.desired_clip_count
      || metadata?.editing_request?.max_moments
      || metadata?.editing_request?.expected_render_count
      || 0
    )||0,
    variants:{
      total:v.length,
      planned:planned.length,
      rendering:rendering.length,
      approved:approved.length,
      failed:failed.length
    },
    clips:v.map(x=>({
      id:x.id,
      title:x.title,
      hook:x.hook,
      status:x.status,
      render_job_id:x.render_job_id,
      render_status_url:x.render_status_url,
      render_url:publicMediaUrl(x.render_url),
      duration_seconds:x.duration_seconds,
      error_message:x.error_message,
      updated_at:x.updated_at,
      approved_at:x.approved_at
    }))
  };
}

export default async (request) => {
  try{
    const {workspaceId}=await requireWorkspace(request);
    const [campaigns,sources,variants] = await Promise.all([
      safe(scopedPath('distribution_campaigns?select=id,name,slug,status,clip_preset_slug,clip_preset_version,created_at,updated_at&order=updated_at.desc&limit=150',workspaceId)),
      safe(scopedPath('campaign_sources?select=id,campaign_id,title,status,source_type,operation_mode,clip_preset_slug,clip_preset_version,duration_seconds,error_message,metadata,created_at,updated_at&order=updated_at.desc&limit=700',workspaceId)),
      safe(scopedPath('clip_variants?select=id,campaign_id,source_id,title,hook,status,render_job_id,render_status_url,render_url,duration_seconds,error_message,approved_at,created_at,updated_at&order=updated_at.desc&limit=5000',workspaceId))
    ]);

    const historical=(variants||[])
      .filter(x=>x.status==='approved'&&x.approved_at&&x.created_at)
      .map(x=>minutes(x.created_at,x.approved_at))
      .filter(x=>x>=1&&x<=90);
    const renderMedian=median(historical)||8;

    const variantsBySource=new Map();
    for(const v of variants||[]){
      const list=variantsBySource.get(v.source_id)||[];
      list.push(v); variantsBySource.set(v.source_id,list);
    }

    const campaignById=new Map((campaigns||[]).map(c=>[c.id,c]));
    const jobs=(sources||[]).map(s=>{
      const job=jobFrom(s,variantsBySource.get(s.id)||[],renderMedian);
      const campaign=campaignById.get(s.campaign_id)||null;
      return {
        ...job,
        campaign_name:campaign?.name||null,
        campaign_slug:campaign?.slug||null
      };
    });
    jobs.sort((a,b)=>{
      const aDone=a.stage==='complete'||a.stage==='failed';
      const bDone=b.stage==='complete'||b.stage==='failed';
      if(aDone!==bDone) return aDone?1:-1;
      return new Date(b.updated_at||0)-new Date(a.updated_at||0);
    });

    const grouped=new Map();
    for(const job of jobs){
      const list=grouped.get(job.campaign_id)||[];
      list.push(job); grouped.set(job.campaign_id,list);
    }

    const campaign_progress=[...(campaigns||[])].map(c=>{
      const list=grouped.get(c.id)||[];
      const progress=list.length?Math.round(list.reduce((n,j)=>n+j.progress,0)/list.length):0;
      const knownEta=list.map(j=>j.eta_minutes).filter(x=>Number.isFinite(x)&&x>0);
      const eta=knownEta.length?Math.max(...knownEta):0;
      const waiting=list.some(j=>j.waiting);
      const error=list.some(j=>j.error);
      const active=list.filter(j=>!['complete','failed'].includes(j.stage)).length;
      return {...c,progress,eta_minutes:waiting?null:eta,waiting,error,active_jobs:active,total_jobs:list.length};
    });

    return jsonResponse({
      jobs,
      campaign_progress,
      render_estimate_minutes:Math.round(renderMedian),
      refreshed_at:new Date().toISOString(),
      summary:{
        active:jobs.filter(j=>!['complete','failed'].includes(j.stage)).length,
        rendering:jobs.filter(j=>j.stage==='rendering').length,
        waiting:jobs.filter(j=>j.waiting).length,
        failed:jobs.filter(j=>j.error).length,
        complete:jobs.filter(j=>j.stage==='complete').length
      }
    });
  }catch(error){ return publicError(error,error.status||500); }
};
