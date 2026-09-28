import { jsonResponse, outreachRequest, publicError, requireUser, supabaseRequest } from './_shared.mjs';

const sum=(rows,key)=>(rows||[]).reduce((n,r)=>n+Number(r?.[key]||0),0);

export default async (request) => {
  try {
    await requireUser(request);
    const [posts,inbox,contacts,outbox,funnelLeads,emailReplies] = await Promise.all([
      supabaseRequest('v_social_post_performance?select=*&order=views.desc&limit=200').catch(()=>[]),
      supabaseRequest('v_social_inbox?select=conversation_id,platform,unread_count&limit=500').catch(()=>[]),
      supabaseRequest('social_contacts?select=id,lead_status,platform&limit=5000').catch(()=>[]),
      supabaseRequest('social_outbox?select=id,status&limit=5000').catch(()=>[]),
      supabaseRequest('funnel_leads?select=id,status,source,utm_source,created_at&order=created_at.desc&limit=5000').catch(()=>[]),
      outreachRequest('conversation_history?channel=eq.email&from_role=eq.lead&select=id&limit=1000').catch(()=>null),
    ]);

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
      social_contacts:(contacts||[]).length,
      qualified_social:(contacts||[]).filter(x=>['qualified','registered','booked','client'].includes(x.lead_status)).length,
      pending_social_replies:(outbox||[]).filter(x=>x.status==='pending').length,
      funnel_leads:(funnelLeads||[]).length,
      email_human_replies:(emailReplies||[]).length,
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
      topPosts:(posts||[]).slice(0,50),
      outreachBridge:Boolean(emailReplies),
      previewMode:true
    });
  } catch(error){
    return publicError(error,error.status||500);
  }
};
