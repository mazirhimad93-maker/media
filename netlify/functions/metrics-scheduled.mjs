import { supabaseRequest } from './_shared.mjs';
import { syncWorkspaceMetrics } from './metrics-core.mjs';

export default async ()=>{
  const workspaces=await supabaseRequest(
    'media_workspaces?status=eq.active&select=id,name&order=created_at.asc&limit=25'
  ).catch(()=>[]);

  const results=[];
  for(const workspace of workspaces||[]){
    try{
      const sync=await syncWorkspaceMetrics(workspace.id,{
        limit:400,
        force:false,
        maxUpdates:40
      });
      results.push({
        workspace_id:workspace.id,
        name:workspace.name,
        checked:sync.checked,
        updated:sync.updated,
        failed:sync.failed
      });
    }catch(error){
      results.push({
        workspace_id:workspace.id,
        name:workspace.name,
        error:error.message
      });
    }
  }

  return new Response(JSON.stringify({
    ok:true,
    workspaces:results,
    ran_at:new Date().toISOString()
  }),{
    status:200,
    headers:{'content-type':'application/json'}
  });
};
