import { randomUUID } from 'node:crypto';
import { jsonResponse, publicError, requireAdmin, supabaseRequest } from './_shared.mjs';

const now=()=>new Date().toISOString();
const isoDaysAgo=(days,hours=12)=>new Date(Date.now()-days*86400000+hours*3600000).toISOString();
const chunk=(arr,size)=>Array.from({length:Math.ceil(arr.length/size)},(_,i)=>arr.slice(i*size,i*size+size));

async function authAdmin(path,{method='GET',body}={}){
  const base=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
  const key=String(process.env.SUPABASE_SERVICE_ROLE_KEY||'');
  if(!base||!key) throw new Error('Supabase admin credentials are not configured');
  const response=await fetch(base+'/auth/v1/'+path,{
    method,
    headers:{apikey:key,Authorization:'Bearer '+key,'content-type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const text=await response.text();
  let data={};
  try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
  if(!response.ok) throw Object.assign(new Error(data?.message||data?.msg||data?.error||'Supabase Auth admin request failed'),{status:response.status,details:data});
  return data;
}

async function findAuthUserByEmail(email){
  for(let page=1;page<=10;page++){
    const result=await authAdmin('admin/users?page='+page+'&per_page=100');
    const users=result?.users||[];
    const found=users.find(user=>String(user.email||'').toLowerCase()===email);
    if(found) return found;
    if(users.length<100) break;
  }
  return null;
}

async function upsertAuthUser(email,password,fullName){
  let user=await findAuthUserByEmail(email);
  if(user){
    user=await authAdmin('admin/users/'+encodeURIComponent(user.id),{
      method:'PUT',
      body:{password,email_confirm:true,user_metadata:{...(user.user_metadata||{}),full_name:fullName,demo_account:true}}
    });
    return user;
  }
  return authAdmin('admin/users',{
    method:'POST',
    body:{email,password,email_confirm:true,user_metadata:{full_name:fullName,demo_account:true}}
  });
}

async function del(table,filter){
  return supabaseRequest(table+'?'+filter,{method:'DELETE',headers:{Prefer:'return=minimal'}}).catch(()=>null);
}
async function insert(table,rows){
  if(!rows?.length) return [];
  const out=[];
  for(const batch of chunk(rows,400)){
    const result=await supabaseRequest(table,{method:'POST',headers:{Prefer:'return=representation'},body:batch});
    out.push(...(result||[]));
  }
  return out;
}

async function clearDemoWorkspace(workspaceId){
  const wid='workspace_id=eq.'+encodeURIComponent(workspaceId);
  const links=await supabaseRequest('tracked_links?'+wid+'&select=id').catch(()=>[]);
  if(links?.length){
    await del('tracked_link_clicks','tracked_link_id=in.('+links.map(x=>encodeURIComponent(x.id)).join(',')+')');
  }
  await del('social_comment_automation_events',wid);
  await del('social_outbox',wid);
  await del('social_messages',wid);
  await del('social_conversations',wid);
  await del('growth_events',wid);
  await del('social_contacts',wid);
  await del('tracked_links',wid);
  await del('post_daily_metrics',wid);
  await del('post_metrics_snapshots',wid);
  await del('content_history',wid);
  await del('content_publish_queue',wid);
  await del('content_assets',wid);
  await del('clip_variants',wid);
  await del('campaign_sources',wid);
  await del('content_campaigns',wid);
  await del('distribution_campaigns',wid);
  await del('content_accounts',wid);
}

const mediaSamples=[
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4'
];

const postSpecs=[
  {title:'The $10K Offer Mistake',hook:'Most offers do not have a traffic problem.',views:184200,likes:8742,comments:512,shares:1904,saves:1280,clicks:438},
  {title:'Stop Optimizing for Views',hook:'A million views can still create zero pipeline.',views:142800,likes:6118,comments:384,shares:1280,saves:902,clicks:392},
  {title:'The Follow-Up That Books Calls',hook:'The first reply is not where the sale happens.',views:118400,likes:5204,comments:346,shares:920,saves:744,clicks:335},
  {title:'The 3-Step Authority Loop',hook:'Attention becomes valuable only when it compounds.',views:96400,likes:4218,comments:278,shares:816,saves:621,clicks:284},
  {title:'Why Most Leads Ghost',hook:'Your lead did not disappear. Your process lost momentum.',views:88100,likes:3860,comments:245,shares:690,saves:544,clicks:257},
  {title:'From Comment to Calendar',hook:'One keyword can turn content into a sales conversation.',views:77300,likes:3421,comments:219,shares:604,saves:498,clicks:226},
  {title:'The 24-Hour Content Flywheel',hook:'One long-form asset can feed an entire acquisition system.',views:68800,likes:2984,comments:188,shares:531,saves:442,clicks:198},
  {title:'What We Track Instead of Likes',hook:'Revenue content has different KPIs.',views:57200,likes:2417,comments:161,shares:418,saves:356,clicks:164},
  {title:'The Distribution Advantage',hook:'Consistency is easier when distribution is infrastructure.',views:49300,likes:2098,comments:142,shares:366,saves:311,clicks:141}
];

const dailyWeights=[0.03,0.12,0.22,0.20,0.15,0.10,0.07,0.05,0.04,0.02];

export default async request=>{
  try{
    requireAdmin(request);
    if(request.method!=='POST') return jsonResponse({error:'POST required'},405);
    const input=await request.json().catch(()=>({}));
    const email=String(input.email||'demo@alchemic.media').trim().toLowerCase();
    const password=String(input.password||'');
    const fullName=String(input.full_name||'Alex Morgan').trim();
    const workspaceName=String(input.workspace_name||'Northstar Growth').trim();
    const slug=String(input.workspace_slug||'northstar-growth-sample').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,64);

    if(password.length<10) return jsonResponse({error:'Provide a demo password with at least 10 characters.'},400);

    const authUser=await upsertAuthUser(email,password,fullName);
    const userId=authUser.id||authUser.user?.id;
    if(!userId) throw new Error('Could not resolve demo Auth user id');

    const existingWs=await supabaseRequest('media_workspaces?slug=eq.'+encodeURIComponent(slug)+'&select=id,name,slug,owner_user_id,is_demo&limit=1').catch(()=>[]);
    let workspace=existingWs?.[0]||null;
    if(!workspace){
      workspace=(await supabaseRequest('media_workspaces',{
        method:'POST',headers:{Prefer:'return=representation'},
        body:{
          name:workspaceName,slug,owner_user_id:userId,status:'active',is_demo:true,
          demo_note:'Sample workspace — performance, leads and conversations are synthetic examples for product demonstration.'
        }
      }))?.[0];
    }else{
      workspace=(await supabaseRequest('media_workspaces?id=eq.'+encodeURIComponent(workspace.id),{
        method:'PATCH',headers:{Prefer:'return=representation'},
        body:{
          name:workspaceName,owner_user_id:userId,status:'active',is_demo:true,
          demo_note:'Sample workspace — performance, leads and conversations are synthetic examples for product demonstration.',
          updated_at:now()
        }
      }))?.[0]||workspace;
    }
    if(!workspace?.id) throw new Error('Could not create demo workspace');

    await supabaseRequest('app_users?on_conflict=user_id',{
      method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},
      body:{user_id:userId,email,full_name:fullName,role:'owner',status:'active',default_workspace_id:workspace.id,updated_at:now()}
    });
    await supabaseRequest('media_workspace_members?on_conflict=workspace_id,user_id',{
      method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},
      body:{workspace_id:workspace.id,user_id:userId,role:'owner',status:'active'}
    });

    await clearDemoWorkspace(workspace.id);

    const igId=randomUUID(), ytId=randomUUID(), ttId=randomUUID();
    const accounts=await insert('content_accounts',[
      {
        id:igId,workspace_id:workspace.id,user_id:userId,platform:'instagram_reels',
        platform_account_id:'demo-ig-'+workspace.id.slice(0,8),username:'northstar.growth',display_name:'Northstar Growth',
        status:'active',is_active:true,niche_tags:['business','marketing','founders'],country:'US',language:'en',timezone:'America/New_York',
        settings_json:{demo:true},daily_limit:4,weekly_limit:28,min_gap_minutes:180,health_status:'healthy',
        scope:'instagram_business_basic instagram_business_manage_messages instagram_business_manage_comments instagram_business_manage_insights',
        capabilities_json:{messages_read:true,messages_send:true,comments:true,analytics:true,publish:true},
        webhook_status:'subscribed',metadata:{demo:true,synthetic:true}
      },
      {
        id:ytId,workspace_id:workspace.id,user_id:userId,platform:'youtube_shorts',
        platform_account_id:'demo-yt-'+workspace.id.slice(0,8),username:'Northstar Growth',display_name:'Northstar Growth',
        status:'active',is_active:true,niche_tags:['business','marketing'],country:'US',language:'en',timezone:'America/New_York',
        settings_json:{demo:true},daily_limit:4,weekly_limit:28,min_gap_minutes:180,health_status:'healthy',
        scope:'youtube.upload yt-analytics.readonly',capabilities_json:{analytics:true,publish:true},
        webhook_status:'not_applicable',metadata:{demo:true,synthetic:true}
      },
      {
        id:ttId,workspace_id:workspace.id,user_id:userId,platform:'tiktok_video',
        platform_account_id:'demo-tt-'+workspace.id.slice(0,8),username:'northstar.daily',display_name:'Northstar Daily',
        status:'active',is_active:true,niche_tags:['business','creator'],country:'US',language:'en',timezone:'America/New_York',
        settings_json:{demo:true},daily_limit:4,weekly_limit:28,min_gap_minutes:180,health_status:'healthy',
        capabilities_json:{publish:true,analytics:true},metadata:{demo:true,synthetic:true}
      }
    ]);

    const distCampaignId=randomUUID(), contentCampaignId=randomUUID();
    await insert('distribution_campaigns',[{
      id:distCampaignId,workspace_id:workspace.id,user_id:userId,name:'Founder Acquisition Engine',
      slug:'founder-acquisition-engine-'+workspace.id.slice(0,6),status:'active',campaign_type:'content_rewards',
      brief:'Sample campaign showing long-form content transformed into distributed short-form lead generation.',
      source_rights_confirmed:true,platforms:['instagram_reels','youtube_shorts','tiktok_video'],
      hook_rules:{style:'direct-response'},creative_rules:{cta_keyword:'SYSTEM',desired_clip_count:9},
      posting_rules:{cadence:'daily'},approval_mode:'first_batch',clip_preset_slug:'source_native',clip_preset_version:1
    }]);
    await insert('content_campaigns',[{
      id:contentCampaignId,workspace_id:workspace.id,distribution_campaign_id:distCampaignId,user_id:userId,
      name:'Founder Acquisition Engine',status:'active',
      brand_rules:{demo:true,cta_keyword:'SYSTEM'},posting_rules:{cadence:'daily'},
      youtube_cta_enabled:true,youtube_cta_url:'https://example.com/training',youtube_cta_label:'Watch the free training'
    }]);

    const sourceIds=[randomUUID(),randomUUID(),randomUUID()];
    await insert('campaign_sources',sourceIds.map((id,index)=>({
      id,workspace_id:workspace.id,campaign_id:distCampaignId,source_type:'organic_render',
      source_url:mediaSamples[index],title:['Founder Growth Masterclass','Organic Acquisition Workshop','Content-to-Calendar Training'][index],
      duration_seconds:[596,742,681][index],status:'analysis_ready',rights_confirmed:true,operation_mode:'long_form_clip',
      metadata:{demo:true,synthetic:true,expected_render_count:3,selector_mode:'sample_seed'},
      clip_preset_slug:'source_native',clip_preset_version:1
    })));

    const platforms=['instagram_reels','youtube_shorts','tiktok_video'];
    const accountIds=[igId,ytId,ttId];
    const variants=[],assets=[],queues=[],histories=[],snapshots=[],daily=[],links=[],clickRows=[];
    const historyIds=[];

    for(let i=0;i<postSpecs.length;i++){
      const spec=postSpecs[i];
      const variantId=randomUUID(),assetId=randomUUID(),queueId=randomUUID(),historyId=randomUUID(),linkId=randomUUID();
      const platform=platforms[i%3],accountId=accountIds[i%3],sourceId=sourceIds[i%3];
      const publishedDaysAgo=29-i*3;
      const publishedAt=isoDaysAgo(Math.max(2,publishedDaysAgo),10+i%6);
      const sampleUrl=mediaSamples[i%3];
      const externalId='demo-post-'+String(i+1).padStart(2,'0')+'-'+workspace.id.slice(0,6);

      variants.push({
        id:variantId,workspace_id:workspace.id,campaign_id:distCampaignId,source_id:sourceId,
        variant_key:'demo-'+workspace.id.slice(0,6)+'-v'+(i+1),title:spec.title,hook:spec.hook,
        caption:spec.hook+'\n\nComment SYSTEM and we will send the breakdown.',
        render_url:sampleUrl,duration_seconds:32+(i%5)*6,
        creative_spec:{demo:true,start_seconds:i*12,end_seconds:i*12+45,cta:'Comment SYSTEM'},
        compliance_report:{demo:true},status:'approved',approved_at:publishedAt,
        clip_preset_slug:'source_native',clip_preset_version:1,created_at:publishedAt,updated_at:publishedAt
      });

      assets.push({
        id:assetId,workspace_id:workspace.id,user_id:userId,campaign_id:contentCampaignId,clip_variant_id:variantId,
        file_name:'northstar-'+String(i+1).padStart(2,'0')+'.mp4',source_url:sampleUrl,mime_type:'video/mp4',
        duration_seconds:32+(i%5)*6,status:'approved',publish_count:1,last_published_at:publishedAt,
        metadata:{demo:true,synthetic:true,hook:spec.hook},created_at:publishedAt,updated_at:publishedAt
      });

      queues.push({
        id:queueId,workspace_id:workspace.id,user_id:userId,campaign_id:contentCampaignId,asset_id:assetId,
        platform,selected_account_id:accountId,account_id:accountId,status:'done',scheduled_at:publishedAt,
        attempt_count:1,max_attempts:5,idempotency_key:'demo-'+queueId,
        completed_at:publishedAt,started_at:publishedAt,finished_at:publishedAt,
        planned_title:spec.title,planned_caption:spec.hook+' Comment SYSTEM for the full breakdown.',
        external_post_id:externalId,external_post_url:'https://example.com/northstar/post/'+(i+1),
        resolved_cta_url:'https://example.com/training',resolved_cta_label:'Free training',resolved_cta_type:'link',
        created_at:publishedAt,updated_at:publishedAt
      });

      histories.push({
        id:historyId,workspace_id:workspace.id,queue_id:queueId,user_id:userId,campaign_id:contentCampaignId,
        asset_id:assetId,account_id:accountId,platform,status:'published',event_type:'published',
        message:spec.title,external_post_id:externalId,external_post_url:'https://example.com/northstar/post/'+(i+1),
        caption:spec.hook,response_json:{demo:true,synthetic:true},created_at:publishedAt
      });
      historyIds.push(historyId);

      snapshots.push({
        workspace_id:workspace.id,history_id:historyId,captured_at:isoDaysAgo(0,i),
        views:spec.views,likes:spec.likes,comments:spec.comments,shares:spec.shares,saves:spec.saves,
        watch_time_seconds:spec.views*18,raw_json:{demo:true,synthetic:true,insights_ok:true}
      });

      let remaining={views:spec.views,likes:spec.likes,comments:spec.comments,shares:spec.shares,saves:spec.saves};
      for(let d=0;d<dailyWeights.length;d++){
        const last=d===dailyWeights.length-1;
        const row={
          views:last?remaining.views:Math.round(spec.views*dailyWeights[d]),
          likes:last?remaining.likes:Math.round(spec.likes*dailyWeights[d]),
          comments:last?remaining.comments:Math.round(spec.comments*dailyWeights[d]),
          shares:last?remaining.shares:Math.round(spec.shares*dailyWeights[d]),
          saves:last?remaining.saves:Math.round(spec.saves*dailyWeights[d])
        };
        remaining.views-=row.views;remaining.likes-=row.likes;remaining.comments-=row.comments;remaining.shares-=row.shares;remaining.saves-=row.saves;
        const metricDate=new Date(new Date(publishedAt).getTime()+d*86400000).toISOString().slice(0,10);
        daily.push({
          workspace_id:workspace.id,history_id:historyId,metric_date:metricDate,source:'demo_seed',platform,
          ...row,watch_time_minutes:Math.round(row.views*0.3),average_view_duration_seconds:18,
          raw_json:{demo:true,synthetic:true}
        });
      }

      links.push({
        id:linkId,workspace_id:workspace.id,slug:'demo-'+workspace.id.slice(0,6)+'-'+(i+1),
        destination_url:'https://example.com/training',label:'Free training',campaign_id:contentCampaignId,
        asset_id:assetId,history_id:historyId,account_id:accountId,utm:{source:platform,medium:'organic',campaign:'founder-acquisition'},is_active:true
      });
      for(let k=0;k<spec.clicks;k++){
        clickRows.push({
          workspace_id:workspace.id,tracked_link_id:linkId,anonymous_id:'demo-'+i+'-'+k,
          ip_hash:'demo',user_agent:'Alchemic Demo',referer:'https://example.com/northstar/post/'+(i+1),
          query_params:{demo:true},occurred_at:new Date(new Date(publishedAt).getTime()+((k%10)+1)*6*3600000+(k%45)*60000).toISOString()
        });
      }
    }

    await insert('clip_variants',variants);
    await insert('content_assets',assets);
    await insert('content_publish_queue',queues);
    await insert('content_history',histories);
    await insert('post_metrics_snapshots',snapshots);
    await insert('post_daily_metrics',daily).catch(()=>[]);
    await insert('tracked_links',links);
    await insert('tracked_link_clicks',clickRows);

    const leadSpecs=[
      {username:'maya.ren',name:'Maya Ren',status:'client',source:0,company:'Growth Studio',revenue:'$18k/mo',booked:true},
      {username:'daniel.ortiz.co',name:'Daniel Ortiz',status:'booked',source:0,company:'Ortiz Advisory',revenue:'$12k/mo',booked:true},
      {username:'sofia.vale',name:'Sofia Vale',status:'booked',source:3,company:'Vale Consulting',revenue:'$25k/mo',booked:true},
      {username:'marcus.builds',name:'Marcus Lee',status:'qualified',source:3,company:'BuildOps',revenue:'$9k/mo',booked:false},
      {username:'nina.growthlab',name:'Nina Cole',status:'qualified',source:6,company:'GrowthLab',revenue:'$15k/mo',booked:false},
      {username:'aaron.scale',name:'Aaron Miles',status:'engaged',source:6,company:'ScaleWorks',revenue:'$7k/mo',booked:false},
      {username:'lena.consults',name:'Lena Ford',status:'booked',source:0,company:'Ford Strategy',revenue:'$20k/mo',booked:true},
      {username:'jon.founder',name:'Jon Hale',status:'qualified',source:3,company:'Hale Media',revenue:'$11k/mo',booked:false},
      {username:'rachel.pipeline',name:'Rachel Kim',status:'client',source:6,company:'Pipeline House',revenue:'$30k/mo',booked:true},
      {username:'sam.productized',name:'Sam Brooks',status:'engaged',source:0,company:'Productized Co',revenue:'$6k/mo',booked:false}
    ];

    const contacts=[],conversations=[],messages=[],growth=[];
    for(let i=0;i<leadSpecs.length;i++){
      const lead=leadSpecs[i];
      const contactId=randomUUID(),conversationId=randomUUID();
      const historyId=historyIds[lead.source];
      const queue=queues[lead.source];
      const started=new Date(Date.now()-(i+1)*5*3600000);
      const thread='demo-thread-'+(i+1)+'-'+workspace.id.slice(0,6);
      contacts.push({
        id:contactId,workspace_id:workspace.id,platform:'instagram_reels',platform_user_id:'demo-lead-'+(i+1)+'-'+workspace.id.slice(0,6),
        username:lead.username,display_name:lead.name,lead_status:lead.status,
        first_seen_at:started.toISOString(),last_seen_at:new Date(started.getTime()+35*60000).toISOString(),
        metadata:{demo:true,synthetic:true,company:lead.company,reported_revenue:lead.revenue}
      });
      conversations.push({
        id:conversationId,workspace_id:workspace.id,account_id:igId,contact_id:contactId,platform:'instagram_reels',
        platform_thread_id:thread,source_history_id:historyId,source_external_post_id:queue.external_post_id,
        status:lead.booked?'booked':lead.status==='qualified'?'qualified':'open',unread_count:i===5?1:0,
        assigned_to:'Alex',human_takeover:true,labels:lead.booked?['inbound','booked']:['inbound','organic'],
        last_message_at:new Date(started.getTime()+35*60000).toISOString(),
        last_inbound_at:new Date(started.getTime()+30*60000).toISOString(),
        last_outbound_at:new Date(started.getTime()+35*60000).toISOString(),
        metadata:{demo:true,synthetic:true,cta_keyword:'SYSTEM'},created_at:started.toISOString(),updated_at:new Date(started.getTime()+35*60000).toISOString()
      });

      const seq=[
        {direction:'inbound',sender_role:'lead',message_type:'comment',body:'SYSTEM',mins:0},
        {direction:'outbound',sender_role:'account',message_type:'private_reply',body:'Saw you commented SYSTEM 👋 Reply YES and I’ll send the breakdown here.',mins:2},
        {direction:'inbound',sender_role:'lead',message_type:'text',body:'YES — I’m curious. We sell '+lead.company+' services and we’re around '+lead.revenue+'.',mins:8},
        {direction:'outbound',sender_role:'account',message_type:'text',body:'Perfect. The training shows the content → conversation → call system. Want the walkthrough and the calendar link?',mins:12},
        {direction:'inbound',sender_role:'lead',message_type:'text',body:lead.booked?'Yes, send it. I can do Thursday.':'Yes please. I want to see how the distribution side works.',mins:18},
        {direction:'outbound',sender_role:'account',message_type:'text',body:lead.booked
          ? 'Booked. Here’s the training: https://example.com/training\n\nZoom for Thursday: https://zoom.us/j/00000000000?pwd=DEMO'
          : 'Here’s the walkthrough: https://example.com/training\n\nIf it fits, reply CALL and we’ll find a time.',mins:35}
      ];
      for(let m=0;m<seq.length;m++){
        const item=seq[m];
        messages.push({
          workspace_id:workspace.id,conversation_id:conversationId,account_id:igId,contact_id:contactId,
          platform_message_id:'demo-msg-'+(i+1)+'-'+(m+1)+'-'+workspace.id.slice(0,6),
          direction:item.direction,sender_role:item.sender_role,message_type:item.message_type,body:item.body,
          delivery_status:item.direction==='outbound'?'read':'received',
          sent_at:new Date(started.getTime()+item.mins*60000).toISOString(),
          raw_json:{demo:true,synthetic:true}
        });
      }
      growth.push({
        workspace_id:workspace.id,event_type:'lead_captured',occurred_at:new Date(started.getTime()+10*60000).toISOString(),
        platform:'instagram_reels',source:'comment_automation',campaign_id:contentCampaignId,
        history_id:historyId,account_id:igId,social_contact_id:contactId,social_conversation_id:conversationId,
        numeric_value:1,metadata:{demo:true,synthetic:true,keyword:'SYSTEM'}
      });
    }
    await insert('social_contacts',contacts);
    await insert('social_conversations',conversations);
    await insert('social_messages',messages);
    await insert('growth_events',growth);

    const totalViews=postSpecs.reduce((n,x)=>n+x.views,0);
    const totalClicks=postSpecs.reduce((n,x)=>n+x.clicks,0);
    return jsonResponse({
      ok:true,
      demo:{
        email,
        workspace_id:workspace.id,
        workspace_name:workspace.name,
        is_demo:true,
        posts:postSpecs.length,
        total_views:totalViews,
        tracked_clicks:totalClicks,
        conversations:leadSpecs.length,
        booked_or_client:leadSpecs.filter(x=>['booked','client'].includes(x.status)).length
      },
      note:'Synthetic sample data is explicitly marked in the workspace. Password is not returned or stored in demo tables.'
    });
  }catch(error){
    return publicError(error,error.status||500);
  }
};
