import { jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest } from './_shared.mjs';

const obj=value=>{
  if(value && typeof value==='object' && !Array.isArray(value)) return value;
  if(typeof value==='string'){ try{return JSON.parse(value)}catch{} }
  return {};
};

export default async request=>{
  try{
    const {workspaceId}=await requireWorkspace(request);
    if(request.method!=='POST') throw Object.assign(new Error('POST required'),{status:405});

    const input=await request.json().catch(()=>({}));
    const action=String(input.action||'delete').toLowerCase();
    const ids=[...new Set((Array.isArray(input.source_ids)?input.source_ids:[])
      .map(value=>String(value||'').trim())
      .filter(Boolean))];

    if(!ids.length) throw Object.assign(new Error('Select at least one clipping job.'),{status:400});
    if(ids.length>100) throw Object.assign(new Error('Delete up to 100 clipping jobs at a time.'),{status:400});
    if(!['delete','restore'].includes(action)) throw Object.assign(new Error('Unsupported clipping job action.'),{status:400});

    const rows=await supabaseRequest(scopedPath(
      'campaign_sources?id=in.('+ids.map(encodeURIComponent).join(',')+')&select=id,title,status,metadata',
      workspaceId
    ));

    const found=new Map((rows||[]).map(row=>[String(row.id),row]));
    const results=[];

    for(const id of ids){
      const source=found.get(id);
      if(!source){
        results.push({source_id:id,ok:false,error:'Clipping job not found in this workspace.'});
        continue;
      }

      const metadata=obj(source.metadata);
      const nextMetadata={
        ...metadata,
        hidden_from_clipper:action==='delete',
        ...(action==='delete'
          ? {hidden_at:new Date().toISOString(),hidden_reason:'user_deleted_from_clipping'}
          : {hidden_at:null,hidden_reason:null})
      };

      try{
        await supabaseRequest(scopedPath(
          'campaign_sources?id=eq.'+encodeURIComponent(id),
          workspaceId
        ),{
          method:'PATCH',
          headers:{Prefer:'return=minimal'},
          body:{metadata:nextMetadata,updated_at:new Date().toISOString()}
        });
        results.push({source_id:id,ok:true,action});
      }catch(error){
        results.push({source_id:id,ok:false,error:error.message});
      }
    }

    const deleted=results.filter(item=>item.ok).length;
    return jsonResponse({
      ok:results.every(item=>item.ok),
      action,
      deleted:action==='delete'?deleted:0,
      restored:action==='restore'?deleted:0,
      results
    });
  }catch(error){
    return publicError(error,error.status||500);
  }
};
