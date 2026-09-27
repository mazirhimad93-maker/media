import { jsonResponse, outreachRequest, publicError, requireAdmin, supabaseRequest } from './_shared.mjs';
export default async (request) => {
  try {
    requireAdmin(request);
    const url=new URL(request.url); const source=url.searchParams.get('source')||'all'; const limit=Math.min(200,Math.max(1,Number(url.searchParams.get('limit')||100))); const offset=Math.max(0,Number(url.searchParams.get('offset')||0));
    const result={social:[],email:[]};
    if(source==='all'||source==='social') result.social=await supabaseRequest(`v_social_inbox?select=*&order=last_message_at.desc.nullslast&limit=${limit}&offset=${offset}`).catch(()=>[]);
    if(source==='all'||source==='email') result.email=(await outreachRequest(`conversation_history?channel=eq.email&from_role=eq.lead&select=id,campaign_id,lead_id,message,timestamp,email_from,email_to,email_subject,channel_id&order=timestamp.desc&limit=${limit}&offset=${offset}`).catch(()=>null))||[];
    return jsonResponse(result);
  } catch(error){ return publicError(error,error.status||500); }
};
