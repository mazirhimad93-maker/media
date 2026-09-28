import { hashIp, supabaseRequest } from './_shared.mjs';

export default async (request)=>{
  const url=new URL(request.url);
  const slug=url.searchParams.get('slug');
  if(!slug) return new Response('Missing link slug',{status:400});

  const rows=await supabaseRequest(
    'tracked_links?slug=eq.'+encodeURIComponent(slug)+'&is_active=eq.true&select=*&limit=1'
  ).catch(()=>[]);
  const link=rows?.[0];
  if(!link) return new Response('Link not found',{status:404});

  const ip=(request.headers.get('x-forwarded-for')||'').split(',')[0].trim();
  const q={};
  for(const [k,v] of url.searchParams.entries()) if(k!=='slug') q[k]=v;

  await supabaseRequest('tracked_link_clicks',{
    method:'POST',
    body:{
      tracked_link_id:link.id,
      anonymous_id:url.searchParams.get('aid')||null,
      ip_hash:hashIp(ip),
      user_agent:request.headers.get('user-agent'),
      referer:request.headers.get('referer'),
      query_params:q,
      ...(link.workspace_id?{workspace_id:link.workspace_id}:{})
    }
  }).catch(()=>{});

  await supabaseRequest('growth_events',{
    method:'POST',
    body:{
      event_type:'link_clicked',
      platform:null,
      source:'tracked_link',
      campaign_id:link.campaign_id,
      asset_id:link.asset_id,
      history_id:link.history_id,
      account_id:link.account_id,
      tracked_link_id:link.id,
      metadata:{slug},
      ...(link.workspace_id?{workspace_id:link.workspace_id}:{})
    }
  }).catch(()=>{});

  const destination=new URL(link.destination_url);
  for(const [k,v] of Object.entries(link.utm||{})){
    if(v&&!destination.searchParams.has(k)) destination.searchParams.set(k,String(v));
  }

  return new Response(null,{status:302,headers:{location:destination.toString(),'cache-control':'no-store'}});
};
