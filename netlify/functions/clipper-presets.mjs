import { jsonResponse, publicError, requireWorkspace, supabaseRequest } from './_shared.mjs';
const slugify=s=>String(s||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80);
const DYNAMIC_LAYER_TYPES=new Set(['video','image','shape','text','hook','captions','cta']);
const isObj=v=>v&&typeof v==='object'&&!Array.isArray(v);
const validatePresetJson=preset=>{
  if(!isObj(preset)) throw Object.assign(new Error('Preset JSON must be an object'),{status:400});
  if(!isObj(preset.composition)) return {preset,contract:String(preset.renderer_contract_version||'13.6')};

  const composition={...preset.composition};
  composition.schema_version=String(composition.schema_version||'1.0');
  if(!['1','1.0','1.1'].includes(composition.schema_version)){
    throw Object.assign(new Error('Unsupported composition schema_version'),{status:400});
  }

  const layers=Array.isArray(composition.layers)?composition.layers:[];
  if(!layers.length) throw Object.assign(new Error('Dynamic presets require at least one composition layer'),{status:400});
  if(layers.length>50) throw Object.assign(new Error('Dynamic presets support at most 50 layers'),{status:400});

  for(const [index,raw] of layers.entries()){
    if(!isObj(raw)) throw Object.assign(new Error('Composition layer '+(index+1)+' must be an object'),{status:400});
    const type=String(raw.type||'').toLowerCase();
    if(!DYNAMIC_LAYER_TYPES.has(type)) throw Object.assign(new Error('Unsupported composition layer type: '+(type||'(missing)')),{status:400});
    if(['video','image'].includes(type)&&!raw.source&&!raw.url){
      throw Object.assign(new Error(type+' layer '+(index+1)+' requires source or url'),{status:400});
    }
  }

  const canvas=isObj(composition.canvas)?composition.canvas:{};
  const width=Number(canvas.width||1080),height=Number(canvas.height||1920);
  if(width<360||height<640||width>2160||height>3840){
    throw Object.assign(new Error('Dynamic preset canvas is outside supported dimensions'),{status:400});
  }

  return {
    preset:{...preset,renderer_contract_version:'14.0',composition:{...composition,canvas:{width,height,background_color:String(canvas.background_color||'#000000')}}},
    contract:'14.0'
  };
};

export default async request=>{
  try{
    const {workspaceId}=await requireWorkspace(request);
    if(request.method==='GET'){
      const query=workspaceId
        ? 'clip_presets?select=id,slug,name,description,category,status,renderer_contract_version,current_version,preset_json,preview_url,is_system,workspace_id,created_at,updated_at&status=neq.archived&or=(is_system.eq.true,workspace_id.eq.'+encodeURIComponent(workspaceId)+')&order=name.asc'
        : 'clip_presets?select=id,slug,name,description,category,status,renderer_contract_version,current_version,preset_json,preview_url,is_system,workspace_id,created_at,updated_at&status=neq.archived&order=name.asc';
      const rows=await supabaseRequest(query).catch(()=>[]);
      return jsonResponse({presets:rows||[]});
    }

    if(request.method!=='POST') return jsonResponse({error:'Method not allowed'},405);

    const body=await request.json();
    const name=String(body.name||'').trim();
    const slug=slugify(body.slug||name);
    if(!name||!slug) return jsonResponse({error:'Preset name is required'},400);

    let presetJson=body.preset_json;
    if(typeof presetJson==='string'){
      try{ presetJson=JSON.parse(presetJson); }catch{ return jsonResponse({error:'Preset JSON is not valid JSON'},400); }
    }

    if(!presetJson && body.base_preset_slug){
      const baseQuery=workspaceId
        ? 'clip_presets?slug=eq.'+encodeURIComponent(body.base_preset_slug)+'&select=preset_json,is_system,workspace_id&or=(is_system.eq.true,workspace_id.eq.'+encodeURIComponent(workspaceId)+')&limit=1'
        : 'clip_presets?slug=eq.'+encodeURIComponent(body.base_preset_slug)+'&select=preset_json,is_system,workspace_id&limit=1';
      const base=await supabaseRequest(baseQuery);
      presetJson=base?.[0]?.preset_json||null;
    }
    if(!presetJson||typeof presetJson!=='object'||Array.isArray(presetJson)) return jsonResponse({error:'Choose a base preset or provide preset JSON'},400);

    presetJson={...presetJson,style_id:presetJson.style_id||slug,template_id:presetJson.template_id||slug,label:presetJson.label||name};
    const checked=validatePresetJson(presetJson);
    presetJson=checked.preset;
    const contract=checked.contract;

    const existing=await supabaseRequest(
      workspaceId
        ? 'clip_presets?slug=eq.'+encodeURIComponent(slug)+'&workspace_id=eq.'+encodeURIComponent(workspaceId)+'&select=*&limit=1'
        : 'clip_presets?slug=eq.'+encodeURIComponent(slug)+'&select=*&limit=1'
    ).catch(()=>[]);
    let saved,version;
    if(existing?.length){
      const current=Number(existing[0].current_version||1);
      version=current+1;
      const updated=await supabaseRequest(`clip_presets?id=eq.${encodeURIComponent(existing[0].id)}`,{
        method:'PATCH',headers:{Prefer:'return=representation'},
        body:{name,description:String(body.description||''),category:String(body.category||'general'),status:'published',renderer_contract_version:contract,current_version:version,preset_json:presetJson,preview_url:body.preview_url||existing[0].preview_url||null,updated_at:new Date().toISOString(),...(workspaceId?{workspace_id:workspaceId}:{})}
      });
      saved=updated?.[0]||existing[0];
    }else{
      version=1;
      const created=await supabaseRequest('clip_presets',{
        method:'POST',headers:{Prefer:'return=representation'},
        body:{slug,name,description:String(body.description||''),category:String(body.category||'general'),status:'published',renderer_contract_version:contract,current_version:1,preset_json:presetJson,preview_url:body.preview_url||null,is_system:false,...(workspaceId?{workspace_id:workspaceId}:{})}
      });
      saved=created?.[0];
    }

    if(!saved?.id) throw new Error('Preset could not be saved');

    await supabaseRequest('clip_preset_versions',{
      method:'POST',
      body:{preset_id:saved.id,preset_slug:slug,version,preset_json:presetJson,renderer_contract_version:contract,change_note:String(body.change_note||'Created from Alchemic Media'),...(workspaceId?{workspace_id:workspaceId}:{})}
    });

    return jsonResponse({ok:true,preset:{...saved,current_version:version}});
  }catch(error){ return publicError(error,error.status||500); }
};
