import { jsonResponse, providerConfig, supabaseRequest } from './_shared.mjs';

export default async(request)=>{
  const url=new URL(request.url);
  if(url.searchParams.get('alchemix')==='1'){
    try{
      const rows=await supabaseRequest(
        'campaign_sources?id=eq.87eafebe-82c3-41c2-a460-b0333490ab61&select=id,title,status,analysis_job_id,analysis_status_url,analysis_result,transcript,transcript_json,duration_seconds,metadata,error_message,updated_at&limit=1'
      );
      return jsonResponse({ok:true,source:rows?.[0]||null});
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
