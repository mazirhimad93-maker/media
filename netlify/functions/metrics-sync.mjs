import { jsonResponse, publicError, requireWorkspace } from './_shared.mjs';
import { syncWorkspaceMetrics } from './metrics-core.mjs';

export default async request=>{
  try{
    const {workspaceId}=await requireWorkspace(request);
    if(request.method!=='POST') throw Object.assign(new Error('POST required'),{status:405});
    const input=await request.json().catch(()=>({}));
    if(input.platform&&!['instagram_reels','youtube_shorts','facebook_page','facebook','tiktok_video','tiktok'].includes(input.platform))
      throw Object.assign(new Error('Unsupported analytics platform.'),{status:400});
    const result=await syncWorkspaceMetrics(workspaceId,{
      limit:input.limit||300,
      force:input.force===true,
      maxUpdates:input.maxUpdates||300,
      platform:input.platform||null
    });
    return jsonResponse(result);
  }catch(error){
    return publicError(error,error.status||500);
  }
};
