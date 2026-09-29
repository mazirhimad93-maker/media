export async function handler(){
  const url='http://54.172.230.194:8092/jobs/6e9920ea-f444-4a6f-8687-c889bfa7fe06';
  try{
    const r=await fetch(url,{headers:{'Accept':'application/json'}});
    const text=await r.text();
    return {statusCode:r.status,headers:{'content-type':r.headers.get('content-type')||'application/json','cache-control':'no-store'},body:text};
  }catch(error){
    return {statusCode:502,headers:{'content-type':'application/json'},body:JSON.stringify({error:String(error?.message||error)})};
  }
}
