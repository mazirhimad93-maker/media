import { jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest } from './_shared.mjs';

const firstUrl=(...values)=>{
  for(const value of values){
    const s=String(value||'').trim();
    if(/^https?:\/\//i.test(s)) return s;
  }
  return null;
};

export default async request=>{
  try{
    const {workspaceId}=await requireWorkspace(request);
    if(request.method!=='POST') return jsonResponse({error:'Method not allowed'},405);

    const body=await request.json().catch(()=>({}));
    const id=String(body.id||'').trim();
    if(!id||id.startsWith('asset:')) return jsonResponse({error:'A clip variant id is required'},400);

    const rows=await supabaseRequest(
      scopedPath(
        'clip_variants?id=eq.'+encodeURIComponent(id)+
        '&select=id,status,render_url,render_status_url,render_job_id,duration_seconds&limit=1',
        workspaceId
      )
    ).catch(()=>[]);
    const clip=rows?.[0];
    if(!clip) return jsonResponse({error:'Clip not found'},404);
    if(clip.render_url) return jsonResponse({ok:true,recovered:false,render_url:clip.render_url,status:clip.status});

    const statusUrl=firstUrl(clip.render_status_url);
    if(!statusUrl) return jsonResponse({ok:false,recovered:false,error:'No renderer status URL is stored for this clip'},409);

    const response=await fetch(statusUrl,{
      headers:{accept:'application/json'},
      signal:AbortSignal.timeout(12000)
    });
    const raw=await response.json().catch(()=>({}));
    if(!response.ok){
      const message=raw.error||raw.message||('Renderer status returned HTTP '+response.status);
      return jsonResponse({ok:false,recovered:false,error:String(message)},502);
    }

    const inner=raw.result&&typeof raw.result==='object'?raw.result:{};
    const renderUrl=firstUrl(
      raw.output_url,raw.url,raw.render_url,
      inner.output_url,inner.url,inner.render_url
    );

    if(!renderUrl){
      return jsonResponse({
        ok:false,
        recovered:false,
        renderer_status:raw.status||inner.status||clip.status,
        error:'Renderer has not returned a final video URL yet'
      },409);
    }

    await supabaseRequest(
      scopedPath('clip_variants?id=eq.'+encodeURIComponent(id),workspaceId),
      {
        method:'PATCH',
        body:{
          render_url:renderUrl,
          duration_seconds:Number(raw.final_duration_seconds||inner.final_duration_seconds||raw.duration_seconds||inner.duration_seconds||clip.duration_seconds||0)||clip.duration_seconds||null,
          updated_at:new Date().toISOString()
        }
      }
    );

    return jsonResponse({
      ok:true,
      recovered:true,
      render_url:renderUrl,
      renderer_status:raw.status||inner.status||null
    });
  }catch(error){
    return publicError(error,error.status||500);
  }
};
