import { jsonResponse, providerConfig, supabaseRequest } from './_shared.mjs';

export default async(request)=>{
  const url=new URL(request.url);
  if(url.searchParams.get('alchemix')==='1'){
    const jobUrl='http://54.172.230.194:8092/jobs/6e9920ea-f444-4a6f-8687-c889bfa7fe06';
    try{
      const response=await fetch(jobUrl,{headers:{accept:'application/json'}});
      const text=await response.text();
      let payload=null;
      try{payload=text?JSON.parse(text):null}catch{payload={raw:text}}
      return jsonResponse({ok:response.ok,status:response.status,payload},response.ok?200:502);
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
