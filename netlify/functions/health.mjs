import { jsonResponse, providerConfig, supabaseRequest } from './_shared.mjs';

export default async()=>{
  let database=false;
  try{
    await supabaseRequest('content_accounts?select=id&limit=1');
    database=true;
  }catch{}
  return jsonResponse({ok:database,database,providers:providerConfig(),time:new Date().toISOString()},database?200:503);
};
