import { jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest } from './_shared.mjs';

export async function saveFollowUp(conversationId, workspaceId, input, db = supabaseRequest) {
  const draft=String(input.draft||'').trim();
  const dueAt=input.dueAt?new Date(input.dueAt):null;
  if(draft.length>5000 || (dueAt && !Number.isFinite(dueAt.getTime()))) throw Object.assign(new Error('Choose a valid follow-up date and a draft under 5,000 characters.'),{status:400});
  if(!input.clear && (!draft || !dueAt)) throw Object.assign(new Error('Add a message and follow-up date.'),{status:400});
  const base=scopedPath('social_conversations?id=eq.'+encodeURIComponent(conversationId),workspaceId);
  for(let attempt=0;attempt<3;attempt++){
    const conversation=(await db(base+'&select=id,metadata&limit=1'))?.[0];
    if(!conversation) throw Object.assign(new Error('Conversation not found'),{status:404});
    const metadata=conversation.metadata||{};
    const followUp=input.clear?null:{draft,due_at:dueAt.toISOString(),saved_at:new Date().toISOString()};
    const changed=await db(base+'&metadata=eq.'+encodeURIComponent(JSON.stringify(metadata))+'&select=id',{
      method:'PATCH',headers:{Prefer:'return=representation'},body:{metadata:{...metadata,follow_up:followUp},updated_at:new Date().toISOString()}
    });
    if(changed?.length) return {ok:true,follow_up:followUp};
  }
  throw Object.assign(new Error('The conversation changed while saving. Try again.'),{status:409});
}

export default async request=>{
  try{
    const {workspaceId}=await requireWorkspace(request);
    if(request.method!=='POST') throw Object.assign(new Error('POST required'),{status:405});
    const input=await request.json();
    if(!input.conversationId) throw Object.assign(new Error('conversationId required'),{status:400});
    return jsonResponse(await saveFollowUp(String(input.conversationId),workspaceId,input));
  }catch(error){return publicError(error,error.status||500);}
};
