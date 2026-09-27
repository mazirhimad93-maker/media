import { jsonResponse, publicError, supabaseRequest } from './_shared.mjs';

const TEMP_PASSWORD='alchemic2026';

export default async (request) => {
  try {
    if(request.method!=='POST') return jsonResponse({error:'Method not allowed'},405);
    const supplied=request.headers.get('x-media-password')||'';
    if(supplied!==TEMP_PASSWORD) return jsonResponse({error:'Invalid media password'},401);
    const body=await request.json();
    const id=String(body.id||'').trim();
    const action=String(body.action||'').trim();
    if(!id||id.startsWith('asset:')) return jsonResponse({error:'A clip variant is required'},400);

    if(action==='approve'){
      const rows=await supabaseRequest(`clip_variants?id=eq.${encodeURIComponent(id)}`,{
        method:'PATCH',
        headers:{Prefer:'return=representation'},
        body:{status:'approved',approved_at:new Date().toISOString(),updated_at:new Date().toISOString()}
      });
      return jsonResponse({ok:true,clip:rows?.[0]||null});
    }

    return jsonResponse({error:'Unsupported action'},400);
  } catch(error){ return publicError(error,error.status||500); }
};
