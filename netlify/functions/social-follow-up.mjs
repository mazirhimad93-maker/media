import {jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest} from './_shared.mjs';

// Retired feature. Only workspace-scoped cleanup remains.
export async function removeSavedFollowUps(workspaceId,db=supabaseRequest) {
  if(!workspaceId) throw Object.assign(new Error('Workspace required'),{status:400});
  const rows=await db(scopedPath('social_conversations?metadata->follow_up=not.is.null&select=id,metadata&limit=100',workspaceId));
  let removed=0;
  for(const row of rows || []) {
    const {follow_up,...metadata}=row.metadata || {};
    const changed=await db(scopedPath('social_conversations?id=eq.'+encodeURIComponent(row.id)+'&metadata=eq.'+encodeURIComponent(JSON.stringify(row.metadata))+'&select=id',workspaceId),{
      method:'PATCH',headers:{Prefer:'return=representation'},body:{metadata,updated_at:new Date().toISOString()}
    });
    if(changed?.length) removed++;
  }
  return {removed,more:(rows || []).length===100};
}
export default async request=>{
  try {
    const {workspaceId}=await requireWorkspace(request);
    if(request.method==='POST') {
      const input=await request.json().catch(()=>({}));
      if(input.action==='removeSavedFollowUps') return jsonResponse(await removeSavedFollowUps(workspaceId));
    }
    return jsonResponse({error:'DM follow-up sequences have been removed.'},410);
  }catch(error){return publicError(error,error.status || 500);}
};
