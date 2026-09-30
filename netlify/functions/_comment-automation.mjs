import { scopedPath, supabaseRequest } from './_shared.mjs';
import { dispatchSocialOutboxItem } from './_social-delivery.mjs';

const clean=value=>String(value||'').trim().toLowerCase().replace(/\s+/g,' ');

function matches(rule,text){
  const keyword=clean(rule.keyword);
  const value=clean(text);
  if(!keyword||!value) return false;
  if(rule.match_type==='contains') return value.includes(keyword);
  if(rule.match_type==='starts_with') return value.startsWith(keyword);
  return value===keyword;
}

function withinPrivateReplyWindow(raw){
  const value=raw?.created_time ?? raw?.timestamp ?? raw?.time;
  if(!value) return true;
  const n=Number(value);
  const ms=Number.isFinite(n) ? (n<1e12?n*1000:n) : Date.parse(String(value));
  if(!Number.isFinite(ms)) return true;
  return Date.now()-ms <= 7*24*60*60*1000;
}

export async function runCommentAutomation({account,contact,conversation,commentId,text,raw={}},db=supabaseRequest){
  if(!account?.workspace_id||!commentId||!contact||!conversation) return {matched:false,reason:'missing_context'};
  if(account.platform!=='instagram_reels') return {matched:false,reason:'platform_not_enabled'};
  if(!withinPrivateReplyWindow(raw)) return {matched:false,reason:'private_reply_window_expired'};

  const rules=await db(scopedPath(
    'comment_automations?is_active=eq.true&platform=eq.instagram_reels'+
    '&or=(account_id.is.null,account_id.eq.'+encodeURIComponent(account.id)+')'+
    '&select=*&order=priority.desc,created_at.asc&limit=100',
    account.workspace_id
  )).catch(()=>[]);

  const rule=(rules||[]).find(item=>matches(item,text));
  if(!rule) return {matched:false,reason:'no_rule'};

  const reserved=await db('comment_automation_runs?on_conflict=account_id,comment_platform_id',{
    method:'POST',
    headers:{Prefer:'resolution=ignore-duplicates,return=representation'},
    body:{
      workspace_id:account.workspace_id,
      automation_id:rule.id,
      account_id:account.id,
      comment_platform_id:String(commentId),
      social_contact_id:contact.id,
      social_conversation_id:conversation.id,
      source_history_id:conversation.source_history_id||null,
      status:'reserved',
      matched_text:String(text||''),
      raw_json:raw
    }
  }).catch(()=>[]);

  const run=reserved?.[0];
  if(!run) return {matched:true,duplicate:true,automation_id:rule.id};

  try{
    const rows=await db('social_outbox',{
      method:'POST',
      headers:{Prefer:'return=representation'},
      body:{
        workspace_id:account.workspace_id,
        conversation_id:conversation.id,
        account_id:account.id,
        contact_id:contact.id,
        reply_mode:'private_reply',
        target_platform_id:String(commentId),
        body:rule.reply_body,
        status:'pending',
        metadata:{automation:true,automation_id:rule.id,automation_name:rule.name,trigger:'comment_keyword',keyword:rule.keyword}
      }
    });
    const outbox=rows?.[0];
    if(!outbox?.id) throw new Error('Automation reply was not added to the outbox');

    await db(scopedPath('comment_automation_runs?id=eq.'+encodeURIComponent(run.id),account.workspace_id),{
      method:'PATCH',body:{outbox_id:outbox.id,status:'queued',updated_at:new Date().toISOString()}
    });

    const delivery=await dispatchSocialOutboxItem(outbox.id,account.workspace_id,{db});
    await db(scopedPath('comment_automation_runs?id=eq.'+encodeURIComponent(run.id),account.workspace_id),{
      method:'PATCH',
      body:{status:delivery.sent?'sent':delivery.status==='failed'?'failed':'queued',error_message:delivery.error||null,updated_at:new Date().toISOString()}
    }).catch(()=>{});

    return {matched:true,automation_id:rule.id,run_id:run.id,outbox_id:outbox.id,delivery};
  }catch(error){
    await db(scopedPath('comment_automation_runs?id=eq.'+encodeURIComponent(run.id),account.workspace_id),{
      method:'PATCH',body:{status:'failed',error_message:String(error.message||error).slice(0,1000),updated_at:new Date().toISOString()}
    }).catch(()=>{});
    return {matched:true,automation_id:rule.id,run_id:run.id,error:error.message};
  }
}
