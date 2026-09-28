import { jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest } from './_shared.mjs';

const sum=(rows,key)=>(rows||[]).reduce((n,r)=>n+Number(r?.[key]||0),0);

export default async (request) => {
  try {
    const {workspaceId}=await requireWorkspace(request);

    const [accounts,allPosts,allInbox,contacts,outbox,funnelLeads] = await Promise.all([
      supabaseRequest(scopedPath('content_accounts?select=id,platform&limit=5000',workspaceId)).catch(()=>[]),
      supabaseRequest('v_social_post_performance?select=*&order=views.desc&limit=5000').catch(()=>[]),
      supabaseRequest('v_social_inbox?select=conversation_id,account_id,contact_id,platform,unread_count&limit=5000').catch(()=>[]),
      supabaseRequest(scopedPath('social_contacts?select=id,lead_status,platform&limit=10000',workspaceId)).catch(()=>[]),
      supabaseRequest(scopedPath('social_outbox?select=id,account_id,status&limit=10000',workspaceId)).catch(()=>[]),
      supabaseRequest(scopedPath('funnel_leads?select=id,status,source,utm_source,created_at&order=created_at.desc&limit=10000',workspaceId)).catch(()=>[]),
    ]);

    const accountIds=new Set((accounts||[]).map(a=>a.id));
    const posts=(allPosts||[]).filter(p=>!workspaceId||accountIds.has(p.account_id));
    const inbox=(allInbox||[]).filter(x=>!workspaceId||accountIds.has(x.account_id));
    const contactIds=new Set((inbox||[]).map(x=>x.contact_id).filter(Boolean));
    const scopedContacts=workspaceId?(contacts||[]).filter(x=>contactIds.has(x.id)):(contacts||[]);
    const scopedOutbox=workspaceId?(outbox||[]).filter(x=>accountIds.has(x.account_id)):(outbox||[]);

    const summary={
      views:sum(posts,'views'),
      likes:sum(posts,'likes'),
      comments:sum(posts,'comments'),
      shares:sum(posts,'shares'),
      saves:sum(posts,'saves'),
      link_clicks:sum(posts,'link_clicks'),
      content_conversations:sum(posts,'conversations'),
      content_leads:sum(posts,'leads'),
      social_conversations:(inbox||[]).length,
      social_unread:sum(inbox,'unread_count'),
      social_contacts:(scopedContacts||[]).length,
      qualified_social:(scopedContacts||[]).filter(x=>['qualified','registered','booked','client'].includes(x.lead_status)).length,
      pending_social_replies:(scopedOutbox||[]).filter(x=>x.status==='pending').length,
      funnel_leads:(funnelLeads||[]).length,
    };

    const byPlatform={};
    for(const post of posts||[]){
      const p=post.platform||'unknown';
      byPlatform[p] ||= {platform:p,posts:0,views:0,likes:0,comments:0,shares:0,saves:0,clicks:0,conversations:0,leads:0};
      const x=byPlatform[p];
      x.posts++;
      x.views+=Number(post.views||0);
      x.likes+=Number(post.likes||0);
      x.comments+=Number(post.comments||0);
      x.shares+=Number(post.shares||0);
      x.saves+=Number(post.saves||0);
      x.clicks+=Number(post.link_clicks||0);
      x.conversations+=Number(post.conversations||0);
      x.leads+=Number(post.leads||0);
    }

    return jsonResponse({
      summary,
      platforms:Object.values(byPlatform),
      topPosts:(posts||[]).slice(0,50)
    });
  } catch(error){
    return publicError(error,error.status||500);
  }
};
