
import { jsonResponse, supabaseRequest } from './_shared.mjs';

const TOKEN="v14-seed-20260929-1729";
const WORKSPACE_ID='4277c681-6149-4c52-b22d-792514096418';
const SOURCE_ID='87eafebe-82c3-41c2-a460-b0333490ab61';
const PRESETS=[{"slug":"alchemic_screen_proof_v1","name":"Alchemic Screen Proof","category":"alchemic","description":"Dynamic V14 evidence-first screen proof preset","json":{"renderer_contract_version":"14.0","style_id":"alchemic_screen_proof_v1","template_id":"alchemic_screen_proof_v1","label":"Alchemic Screen Proof","composition":{"schema_version":"1.0","canvas":{"width":1080,"height":1920,"background_color":"#090909"},"thumbnail":{"enabled":true,"seconds":0.35},"audio":{"use_source_audio":true,"music_gain_db":-24},"layers":[{"id":"proof","type":"video","source":"source_video","z_index":10,"x_percent":50,"y_percent":32,"width_percent":92,"height_percent":34,"anchor":"center","fit":"contain","border_color":"#F5B83D","border_width_px":4},{"id":"divider","type":"shape","shape":"line","z_index":15,"x_percent":50,"y_percent":52,"width_percent":90,"height_percent":1,"anchor":"center","color":"#F5B83D","border_width_px":4},{"id":"portrait","type":"image","source":"portrait","z_index":20,"x_percent":18,"y_percent":68,"width_percent":28,"height_percent":22,"anchor":"center","fit":"cover","border_color":"#F5B83D","border_width_px":5},{"id":"identity","type":"text","text":"JULIAN | ALCHEMIC","z_index":30,"x_percent":57,"y_percent":62,"style":{"font_family":"Inter","font_size_ratio":0.021,"font_weight":800,"color":"#FFFFFF","max_width_percent":55}},{"id":"hook","type":"hook","source":"hook","z_index":40,"x_percent":50,"y_percent":8,"style":{"font_family":"Inter","font_size_ratio":0.035,"font_weight":800,"color":"#FFFFFF","highlight_color":"#F5B83D","outline_color":"#000000","outline_width_px":3,"max_width_percent":88,"max_lines":2}},{"id":"captions","type":"captions","source":"transcript_segments","z_index":45,"x_percent":50,"y_percent":80,"style":{"enabled":true,"font_family":"Inter","font_size_ratio":0.024,"font_weight":700,"color":"#FFFFFF","highlight_color":"#F5B83D","outline_color":"#000000","outline_width_px":2,"max_width_percent":84,"max_lines":2,"words_per_chunk":6,"words_per_line":3}},{"id":"cta","type":"cta","source":"cta","z_index":50,"x_percent":50,"y_percent":91,"timing":{"mode":"last_seconds","duration_seconds":4},"style":{"font_family":"Inter","font_size_ratio":0.022,"font_weight":800,"color":"#FFFFFF","background_enabled":true,"background_color":"#18181B","background_opacity":0.94,"max_width_percent":82,"max_lines":3}}]}}},{"slug":"alchemic_document_explainer_v1","name":"Alchemic Document Explainer","category":"alchemic","description":"Dynamic V14 document and screen explanation preset","json":{"renderer_contract_version":"14.0","style_id":"alchemic_document_explainer_v1","template_id":"alchemic_document_explainer_v1","label":"Alchemic Document Explainer","composition":{"schema_version":"1.0","canvas":{"width":1080,"height":1920,"background_color":"#0A0A0A"},"thumbnail":{"enabled":true,"seconds":0.35},"audio":{"use_source_audio":true,"music_gain_db":-26},"layers":[{"id":"source","type":"video","source":"source_video","z_index":10,"x_percent":50,"y_percent":34,"width_percent":94,"height_percent":48,"anchor":"center","fit":"contain"},{"id":"portrait","type":"image","source":"portrait","z_index":20,"x_percent":18,"y_percent":69,"width_percent":24,"height_percent":20,"anchor":"center","fit":"cover","border_color":"#F5B83D","border_width_px":4},{"id":"hook","type":"hook","source":"hook","z_index":40,"x_percent":50,"y_percent":8,"style":{"font_family":"Inter","font_size_ratio":0.034,"font_weight":800,"color":"#FFFFFF","highlight_color":"#F5B83D","outline_color":"#000000","outline_width_px":3,"max_width_percent":88,"max_lines":3}},{"id":"captions","type":"captions","source":"transcript_segments","z_index":45,"x_percent":58,"y_percent":71,"style":{"enabled":true,"font_family":"Inter","font_size_ratio":0.024,"font_weight":700,"color":"#FFFFFF","highlight_color":"#F5B83D","outline_color":"#000000","outline_width_px":2,"max_width_percent":62,"max_lines":2,"words_per_chunk":6,"words_per_line":3}},{"id":"cta","type":"cta","source":"cta","z_index":50,"x_percent":50,"y_percent":91,"timing":{"mode":"last_seconds","duration_seconds":4},"style":{"font_family":"Inter","font_size_ratio":0.022,"font_weight":800,"color":"#FFFFFF","background_enabled":true,"background_color":"#18181B","background_opacity":0.94,"max_width_percent":82,"max_lines":3}}]}}},{"slug":"alchemic_conversation_casefile_v1","name":"Alchemic Conversation Case File","category":"alchemic","description":"Dynamic V14 case-file preset for client conversations and proof","json":{"renderer_contract_version":"14.0","style_id":"alchemic_conversation_casefile_v1","template_id":"alchemic_conversation_casefile_v1","label":"Alchemic Conversation Case File","composition":{"schema_version":"1.0","canvas":{"width":1080,"height":1920,"background_color":"#070707"},"thumbnail":{"enabled":true,"seconds":0.35},"audio":{"use_source_audio":true,"music_gain_db":-26},"layers":[{"id":"source","type":"video","source":"source_video","z_index":10,"x_percent":50,"y_percent":31,"width_percent":94,"height_percent":40,"anchor":"center","fit":"contain","border_color":"#242424","border_width_px":3},{"id":"casefile_rule","type":"shape","shape":"line","z_index":15,"x_percent":50,"y_percent":53,"width_percent":88,"height_percent":1,"anchor":"center","color":"#F5B83D","border_width_px":4},{"id":"portrait","type":"image","source":"portrait","z_index":20,"x_percent":18,"y_percent":69,"width_percent":26,"height_percent":22,"anchor":"center","fit":"cover","border_color":"#F5B83D","border_width_px":4},{"id":"case_label","type":"text","text":"CASE FILE","z_index":30,"x_percent":60,"y_percent":61,"style":{"font_family":"Inter","font_size_ratio":0.017,"font_weight":900,"color":"#F5B83D","max_width_percent":40}},{"id":"hook","type":"hook","source":"hook","z_index":40,"x_percent":50,"y_percent":8,"style":{"font_family":"Inter","font_size_ratio":0.033,"font_weight":800,"color":"#FFFFFF","highlight_color":"#F5B83D","outline_color":"#000000","outline_width_px":3,"max_width_percent":90,"max_lines":3}},{"id":"captions","type":"captions","source":"transcript_segments","z_index":45,"x_percent":60,"y_percent":72,"style":{"enabled":true,"font_family":"Inter","font_size_ratio":0.023,"font_weight":700,"color":"#FFFFFF","highlight_color":"#F5B83D","outline_color":"#000000","outline_width_px":2,"max_width_percent":58,"max_lines":2,"words_per_chunk":6,"words_per_line":3}},{"id":"cta","type":"cta","source":"cta","z_index":50,"x_percent":50,"y_percent":91,"timing":{"mode":"last_seconds","duration_seconds":4},"style":{"font_family":"Inter","font_size_ratio":0.022,"font_weight":800,"color":"#FFFFFF","background_enabled":true,"background_color":"#18181B","background_opacity":0.94,"max_width_percent":82,"max_lines":3}}]}}}];

export default async request=>{
  const url=new URL(request.url);
  if(url.searchParams.get('token')!==TOKEN) return jsonResponse({error:'not found'},404);
  try{
    const versions={};
    for(const p of PRESETS){
      const existing=await supabaseRequest(
        'clip_presets?slug=eq.'+encodeURIComponent(p.slug)+'&select=*&limit=1'
      ).catch(()=>[]);
      let saved,version;
      if(existing?.length){
        version=Number(existing[0].current_version||1)+1;
        const updated=await supabaseRequest('clip_presets?id=eq.'+encodeURIComponent(existing[0].id),{
          method:'PATCH',headers:{Prefer:'return=representation'},
          body:{
            name:p.name,description:p.description,category:p.category,status:'published',
            renderer_contract_version:'14.0',current_version:version,preset_json:p.json,
            updated_at:new Date().toISOString(),workspace_id:WORKSPACE_ID
          }
        });
        saved=updated?.[0]||existing[0];
      }else{
        version=1;
        const created=await supabaseRequest('clip_presets',{
          method:'POST',headers:{Prefer:'return=representation'},
          body:{
            slug:p.slug,name:p.name,description:p.description,category:p.category,status:'published',
            renderer_contract_version:'14.0',current_version:version,preset_json:p.json,
            is_system:false,workspace_id:WORKSPACE_ID
          }
        });
        saved=created?.[0];
      }
      if(!saved?.id) throw new Error('Could not save '+p.slug);
      await supabaseRequest('clip_preset_versions',{
        method:'POST',
        body:{
          preset_id:saved.id,preset_slug:p.slug,version,preset_json:p.json,
          renderer_contract_version:'14.0',
          change_note:'Migrated to Dynamic Renderer V14',
          workspace_id:WORKSPACE_ID
        }
      });
      versions[p.slug]=version;
      await supabaseRequest(
        'clip_variants?source_id=eq.'+SOURCE_ID+'&clip_preset_slug=eq.'+encodeURIComponent(p.slug),
        {method:'PATCH',headers:{Prefer:'return=minimal'},body:{clip_preset_version:version,updated_at:new Date().toISOString()}}
      );
    }

    await supabaseRequest('clip_variants?source_id=eq.'+SOURCE_ID,{
      method:'PATCH',headers:{Prefer:'return=minimal'},
      body:{status:'queued',error_message:null,updated_at:new Date().toISOString()}
    });

    return jsonResponse({ok:true,versions,source_id:SOURCE_ID,variants_parked:'queued'});
  }catch(error){
    return jsonResponse({ok:false,error:String(error?.message||error),details:error?.details||null},500);
  }
};
