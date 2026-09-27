import { jsonResponse, supabaseRequest } from './_shared.mjs';
export default async () => {
  const threshold = new Date(Date.now()+10*24*60*60*1000).toISOString();
  const accounts = await supabaseRequest(`content_accounts?platform=eq.instagram_reels&is_active=eq.true&status=eq.active&token_expires_at=lte.${encodeURIComponent(threshold)}&select=id,username,access_token`);
  const results=[];
  for (const account of accounts || []) {
    try {
      const url = new URL('https://graph.instagram.com/refresh_access_token');
      url.search = new URLSearchParams({grant_type:'ig_refresh_token',access_token:account.access_token});
      const response=await fetch(url); const token=await response.json();
      if(!response.ok||!token.access_token) throw new Error(token.error?.message||'Refresh failed');
      const expiresAt=new Date(Date.now()+Number(token.expires_in||5184000)*1000).toISOString();
      await supabaseRequest(`content_accounts?id=eq.${encodeURIComponent(account.id)}`,{method:'PATCH',body:{access_token:token.access_token,token_expires_at:expiresAt,health_status:'healthy',error_message:null,updated_at:new Date().toISOString()}});
      results.push({id:account.id,username:account.username,status:'refreshed',token_expires_at:expiresAt});
    } catch(error) {
      await supabaseRequest(`content_accounts?id=eq.${encodeURIComponent(account.id)}`,{method:'PATCH',body:{health_status:'warning',error_message:'Instagram token refresh failed',updated_at:new Date().toISOString()}}).catch(()=>{});
      results.push({id:account.id,username:account.username,status:'failed'});
    }
  }
  return jsonResponse({checked:accounts?.length||0,results});
};
