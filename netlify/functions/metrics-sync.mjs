import { jsonResponse, publicError, requireWorkspace } from './_shared.mjs';
import { syncWorkspaceMetrics } from './metrics-core.mjs';

export default async request=>{
  try{
    const {workspaceId}=await requireWorkspace(request);
    if(request.method!=='POST') throw Object.assign(new Error('POST required'),{status:405});
    const input=await request.json().catch(()=>({}));
    const result=await syncWorkspaceMetrics(workspaceId,{
      limit:input.limit||300,
      force:input.force===true,
      maxUpdates:input.maxUpdates||300
    });
    return jsonResponse(result);
  }catch(error){
    return publicError(error,error.status||500);
  }
};
