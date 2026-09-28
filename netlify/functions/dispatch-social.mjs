import { jsonResponse, publicError, requireAdmin, rpc } from './_shared.mjs';
import { deliverClaimedSocialJob } from './_social-delivery.mjs';

export default async (request)=>{
  try{
    requireAdmin(request);
    if(request.method!=='POST') throw Object.assign(new Error('POST required'),{status:405});
    const input=await request.json().catch(()=>({}));
    const limit=Math.min(25,Math.max(1,Number(input.limit||10)));
    const worker=`social-hub-${Date.now()}`;
    const jobs=(await rpc('claim_social_outbox',{p_worker:worker,p_limit:limit}))||[];
    const results=[];
    for(const job of jobs) results.push(await deliverClaimedSocialJob(job));
    return jsonResponse({claimed:jobs.length,results});
  }catch(error){ return publicError(error,error.status||500); }
};
