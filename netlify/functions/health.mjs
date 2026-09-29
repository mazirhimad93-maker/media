import { jsonResponse, providerConfig, supabaseRequest } from './_shared.mjs';

export default async(request)=>{
  const url=new URL(request.url);
  if(url.searchParams.get('alchemix')==='1'){
    try{
      const [rows,presets,variants]=await Promise.all([
        supabaseRequest('campaign_sources?id=eq.87eafebe-82c3-41c2-a460-b0333490ab61&select=id,title,status,source_url,analysis_job_id,analysis_status_url,analysis_result,transcript,transcript_json,duration_seconds,metadata,error_message,updated_at&limit=1'),
        supabaseRequest('clip_presets?slug=in.(alchemic_screen_proof_v1,alchemic_document_explainer_v1,alchemic_conversation_casefile_v1)&select=slug,name,status,current_version,preset_json,renderer_contract_version,preview_url&limit=10'),
        supabaseRequest('clip_variants?source_id=eq.87eafebe-82c3-41c2-a460-b0333490ab61&select=id,variant_key,title,status,render_url,render_job_id,render_status_url,duration_seconds,error_message,updated_at,approved_at&order=updated_at.desc&limit=20')
      ]);
      return jsonResponse({ok:true,source:rows?.[0]||null,presets,variants});
    }catch(error){
      return jsonResponse({ok:false,error:String(error?.message||error)},502);
    }
  }

  let database=false;
  try{
    await supabaseRequest('content_accounts?select=id&limit=1');
    database=true;
  }catch{}
  return jsonResponse({ok:database,database,providers:providerConfig(),time:new Date().toISOString()},database?200:503);
};
