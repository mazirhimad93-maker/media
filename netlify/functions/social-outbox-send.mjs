import { jsonResponse, publicError, requireWorkspace } from './_shared.mjs';
import { dispatchSocialOutboxItem } from './_social-delivery.mjs';

export default async (request)=>{
  try{
    const {workspaceId}=await requireWorkspace(request);
    if(request.method!=='POST') throw Object.assign(new Error('POST required'),{status:405});
    const input=await request.json();
    const id=String(input.outboxId||'');
    if(!id) throw Object.assign(new Error('outboxId required'),{status:400});
    return jsonResponse(await dispatchSocialOutboxItem(id,workspaceId));
  }catch(error){return publicError(error,error.status||500);}
};
