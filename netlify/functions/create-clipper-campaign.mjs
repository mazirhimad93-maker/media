import { jsonResponse, publicError, supabaseRequest } from './_shared.mjs';
const WRITE_KEY='alchemic2026';
const slugify=s=>String(s||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,90);
const directMedia=url=>/\.(mp4|m4v|mov|webm)(?:$|[?#])/i.test(url);
const provider=url=>{
  const s=String(url||'').toLowerCase();
  if(s.includes('youtube.com')||s.includes('youtu.be')) return 'youtube';
  if(s.includes('instagram.com')) return 'instagram';
  if(s.includes('tiktok.com')) return 'tiktok';
  if(s.includes('facebook.com')||s.includes('fb.watch')) return 'facebook';
  if(s.includes('drive.google.com')) return 'google_drive';
  if(s.includes('vimeo.com')) return 'vimeo';
  return directMedia(url)?'direct_media':'url';
};

export default async request=>{
  try{
    if(request.method!=='POST') return jsonResponse({error:'Method not allowed'},405);
    if((request.headers.get('x-media-password')||'')!==WRITE_KEY) return jsonResponse({error:'Invalid media password'},401);

    const body=await request.json();
    const name=String(body.name||'').trim();
    const sourceUrl=String(body.source_url||'').trim();
    const sourceTitle=String(body.source_title||name||'Source video').trim();
    const presetSlug=String(body.preset_slug||'source_native').trim();
    const presetVersion=Math.max(1,Number(body.preset_version||1));
    const operationMode=String(body.operation_mode||'long_form_clip');
    const selectorMode=String(body.selector_mode||'ollama_ranked');
    const desiredClips=Math.max(1,Math.min(3,Number(body.desired_clips||3)));
    const editingPrompt=String(body.editing_prompt||'').trim();
    const ctaText=String(body.cta_text||'').trim();

    if(!name) return jsonResponse({error:'Campaign name is required'},400);
    if(!/^https?:\/\//i.test(sourceUrl)) return jsonResponse({error:'A valid http(s) source URL is required'},400);
    if(body.rights_confirmed!==true) return jsonResponse({error:'Confirm that you are authorized to repurpose this source'},400);
    if(!['long_form_clip','variation_factory','publish_as_is'].includes(operationMode)) return jsonResponse({error:'Invalid operation mode'},400);
    if(!['ollama_ranked','chatgpt_external','full_source_locked'].includes(selectorMode)) return jsonResponse({error:'Invalid selector mode'},400);

    let slug=slugify(body.slug||name);
    const existing=await supabaseRequest(`distribution_campaigns?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`).catch(()=>[]);
    if(existing?.length) slug=`${slug}-${Date.now().toString(36).slice(-5)}`;

    const creativeRules={
      preset_slug:presetSlug,
      preset_version:presetVersion,
      desired_clip_count:desiredClips
    };
    if(editingPrompt) creativeRules.editing_prompt=editingPrompt;
    if(ctaText) creativeRules.cta_text=ctaText;

    const campaigns=await supabaseRequest('distribution_campaigns',{
      method:'POST',headers:{Prefer:'return=representation'},
      body:{
        name,slug,status:'active',campaign_type:'content_rewards',
        brief:String(body.brief||'Created in Alchemic Media'),
        source_rights_confirmed:true,
        clip_preset_slug:presetSlug,
        clip_preset_version:presetVersion,
        creative_rules:creativeRules,
        hook_rules:{},
        posting_rules:{}
      }
    });
    const campaign=campaigns?.[0];
    if(!campaign?.id) throw new Error('Campaign was not created');

    const isDirect=directMedia(sourceUrl);
    const sourceStatus=isDirect?'ready':'pending_ingest';
    const sourceProvider=provider(sourceUrl);
    const metadata={
      semantic_source_type:isDirect?'authorized_direct_mp4':sourceProvider,
      source_key:`${slug}-source-1`,
      original_source_url:sourceUrl,
      ingest_mode:isDirect?'direct':'resolve_url',
      source_provider:sourceProvider,
      selector_mode:selectorMode,
      selection_provider:selectorMode==='chatgpt_external'?'chatgpt':'ollama',
      rights_confirmed_by_user:true,
      expected_render_count:desiredClips,
      editing_request:{
        preset_slug:presetSlug,
        preset_version:presetVersion,
        selector_mode:selectorMode,
        variants_per_moment:1,
        max_variants_per_moment:1,
        require_exact_variant_count:false,
        editing_prompt:editingPrompt||undefined,
        cta_text:ctaText||undefined
      }
    };
    if(isDirect){
      metadata.canonical_media_url=sourceUrl;
      metadata.resolved_source_url=sourceUrl;
      metadata.ingest_provider='direct_media';
    }

    const sources=await supabaseRequest('campaign_sources',{
      method:'POST',headers:{Prefer:'return=representation'},
      body:{
        campaign_id:campaign.id,
        source_type:'organic_render',
        source_url:sourceUrl,
        title:sourceTitle,
        status:sourceStatus,
        rights_confirmed:true,
        metadata,
        operation_mode:operationMode,
        clip_preset_slug:presetSlug,
        clip_preset_version:presetVersion,
        error_message:null
      }
    });

    return jsonResponse({
      ok:true,
      campaign,
      source:sources?.[0]||null,
      message:isDirect?'Source queued for analysis.':'Source queued for ingestion.',
      note:selectorMode==='chatgpt_external'?'The job will pause after analysis for external moment selection.':'The existing Clipper workflow can process this automatically.'
    });
  }catch(error){ return publicError(error,error.status||500); }
};
