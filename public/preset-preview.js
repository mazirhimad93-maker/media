const media=window.__alchemic;
if(!media) throw new Error('Alchemic core unavailable');

const {state,esc}=media;
const $=id=>document.getElementById(id);

const asObj=value=>{
  if(value&&typeof value==='object'&&!Array.isArray(value)) return value;
  if(typeof value==='string'){
    try{
      const parsed=JSON.parse(value);
      return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};
    }catch{}
  }
  return {};
};

const pct=(value,fallback)=>Math.max(0,Math.min(100,Number.isFinite(Number(value))?Number(value):fallback));
const clamp=(value,min,max,fallback)=>Math.max(min,Math.min(max,Number.isFinite(Number(value))?Number(value):fallback));
const text=value=>String(value??'').trim();

function starterPreset(){
  return {
    renderer_contract_version:'14.0',
    style_id:'dynamic-v14-preset',
    template_id:'dynamic-v14-preset',
    label:'Dynamic V14 Preset',
    composition:{
      schema_version:'1.0',
      canvas:{width:1080,height:1920,background_color:'#090909'},
      thumbnail:{enabled:true,seconds:.35},
      audio:{use_source_audio:true,music_gain_db:-24},
      layers:[
        {id:'source_video',type:'video',source:'source_video',z_index:10,x_percent:50,y_percent:37,width_percent:92,height_percent:46,anchor:'center',fit:'contain'},
        {id:'hook',type:'hook',source:'hook',z_index:40,x_percent:50,y_percent:9,style:{font_family:'Inter',font_size_ratio:.035,font_weight:800,color:'#FFFFFF',highlight_color:'#F5B83D',max_width_percent:88,max_lines:2,outline_color:'#000000',outline_width_px:3}},
        {id:'captions',type:'captions',source:'transcript_segments',z_index:45,x_percent:50,y_percent:76,style:{enabled:true,font_family:'Inter',font_size_ratio:.026,font_weight:700,color:'#FFFFFF',highlight_color:'#F5B83D',outline_color:'#000000',outline_width_px:2,max_width_percent:84,max_lines:2,words_per_chunk:6,words_per_line:3}},
        {id:'cta',type:'cta',source:'cta',z_index:50,x_percent:50,y_percent:89,timing:{mode:'last_seconds',duration_seconds:4},style:{font_family:'Inter',font_size_ratio:.024,font_weight:800,color:'#FFFFFF',background_enabled:true,background_color:'#18181B',background_opacity:.94,max_width_percent:82,max_lines:3}}
      ]
    }
  };
}

function dynamicComposition(raw){
  const root=asObj(raw);
  return asObj(root.composition);
}

function dynamicLayerBox(layer){
  const position=asObj(layer.position);
  const size=asObj(layer.size);
  const x=pct(position.x_percent??layer.x_percent,50);
  const y=pct(position.y_percent??layer.y_percent,50);
  const w=pct(size.width_percent??layer.width_percent,30);
  const h=pct(size.height_percent??layer.height_percent,20);
  const anchor=text(position.anchor||layer.anchor||'center');
  const transform=anchor==='top_left'?'none':'translate(-50%,-50%)';
  return `left:${x}%;top:${y}%;width:${w}%;height:${h}%;transform:${transform}`;
}

function dynamicTextStyle(layer,defaults={}){
  const style={...defaults,...asObj(layer.style),...asObj(layer.typography)};
  const position={...asObj(layer.position)};
  return layerStyle({
    ...style,
    position_x_percent:position.x_percent??layer.x_percent??style.position_x_percent,
    position_y_percent:position.y_percent??layer.y_percent??style.position_y_percent
  },defaults);
}

function renderDynamic(host,meta,preset,sourceLabel){
  const composition=dynamicComposition(preset);
  const canvas=asObj(composition.canvas);
  const presetAssets=asObj(asObj(preset).assets);
  const layers=(Array.isArray(composition.layers)?composition.layers:[])
    .map((layer,index)=>({...asObj(layer),__index:index,z_index:Number(asObj(layer).z_index??index)}))
    .sort((a,b)=>a.z_index-b.z_index||a.__index-b.__index);

  host.style.background=cssColor(canvas.background_color,'#09090b');
  const html=['<div class="preset-safe-zone"></div>'];

  for(const layer of layers){
    const type=text(layer.type).toLowerCase();
    if(type==='video'){
      html.push(`<div class="preset-video-placeholder dynamic-composition-layer" style="${dynamicLayerBox(layer)};overflow:hidden">${mockVideoHtml()}<div class="dynamic-layer-tag">VIDEO · ${esc(text(layer.source)||'source_video')}</div></div>`);
      continue;
    }
    if(type==='image'){
      const sourceKey=text(layer.source).replace(/^asset:/,'');
      const assetValue=presetAssets[sourceKey];
      const assetUrl=typeof assetValue==='string'?assetValue:text(asObj(assetValue).url||asObj(assetValue).public_url);
      const directUrl=text(layer.url||assetUrl);
      html.push(`<div class="dynamic-image-placeholder dynamic-composition-layer" style="${dynamicLayerBox(layer)};border:${Math.max(1,Number(layer.border_width_px||2))}px solid ${cssColor(layer.border_color,'#F5B83D')};overflow:hidden">${/^https:\/\//i.test(directUrl)?`<img src="${esc(directUrl)}" alt="">`:`<div class="dynamic-image-label">IMAGE<br><small>${esc(text(layer.source)||'asset')}</small></div>`}</div>`);
      continue;
    }
    if(type==='shape'){
      const style=asObj(layer.style);
      const color=cssColor(style.color||layer.color,'#F5B83D');
      const opacity=clamp(style.opacity??layer.opacity,0,1,1);
      html.push(`<div class="dynamic-shape-layer dynamic-composition-layer" style="${dynamicLayerBox(layer)};background:${color};opacity:${opacity}"></div>`);
      continue;
    }
    if(['hook','cta','text','captions'].includes(type)){
      let sample='';
      if(type==='hook') sample='YOUR HOOK / HEADLINE';
      else if(type==='cta') sample='YOUR CALL TO ACTION';
      else if(type==='captions') sample='This is how captions will appear';
      else sample=text(layer.text)||'TEXT LAYER';
      html.push(`<div class="preset-text-layer dynamic-composition-layer" style="${dynamicTextStyle(layer,{position_x_percent:50,position_y_percent:50,max_width_percent:86,font_size_ratio:type==='hook'?.035:type==='cta'?.024:.026,font_weight:type==='hook'||type==='cta'?800:700,color:'#ffffff',outline_color:'#000000'})}">${esc(sample)}</div>`);
    }
  }

  host.innerHTML=html.join('');
  meta.innerHTML=[
    ['Source',sourceLabel],
    ['Engine','Dynamic V14'],
    ['Schema',text(composition.schema_version||'1.0')],
    ['Layers',String(layers.length)],
    ['Canvas',String(Number(canvas.width||1080))+'×'+String(Number(canvas.height||1920))],
    ['Renderer','14.0']
  ].map(([label,value])=>`<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
}
function selectedBase(){
  const slug=$('preset-base')?.value;
  if(slug==='__dynamic_v14__') return null;
  return (state.presets?.presets||[]).find(p=>String(p.slug)===String(slug))||null;
}

function rawPreset(){
  const raw=$('preset-json')?.value?.trim()||'';
  if(raw){
    try{
      const parsed=JSON.parse(raw);
      if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)){
        return {
          json:selectedBase()?.preset_json||{},
          source:selectedBase()?.name||'base preset',
          error:'Advanced preset JSON must be a JSON object.'
        };
      }
      return {json:parsed,source:'Custom JSON',error:null};
    }catch(error){
      return {
        json:selectedBase()?.preset_json||{},
        source:selectedBase()?.name||'base preset',
        error:'Invalid JSON: '+error.message
      };
    }
  }

  const base=selectedBase();
  if($('preset-base')?.value==='__dynamic_v14__'){
    return {json:starterPreset(),source:'Blank Dynamic V14',error:null};
  }
  return {
    json:base?.preset_json||{},
    source:base?.name||'Base preset',
    error:null
  };
}

function unwrapPreset(raw){
  const root=asObj(raw);

  if(Array.isArray(root.styles)&&root.styles.length) return asObj(root.styles[0]);
  if(Array.isArray(root.resolved_styles)&&root.resolved_styles.length) return asObj(root.resolved_styles[0]);

  const templateStyle=asObj(root.template_style);
  if(Object.keys(templateStyle).length) return templateStyle;

  const style=asObj(root.style);
  if(Object.keys(style).length) return style;

  const preset=asObj(root.preset);
  if(Object.keys(preset).length) return preset;

  return root;
}

function cssColor(value,fallback){
  const v=text(value);
  if(/^#[0-9a-f]{3,8}$/i.test(v)||/^rgba?\(/i.test(v)||/^hsla?\(/i.test(v)) return v;
  return fallback;
}

function cssFont(value){
  const raw=text(value)||'Inter';
  // Keep the preview safe even if someone pastes unusual JSON.
  return raw.replace(/[^a-z0-9 _-]/gi,'').slice(0,60)||'Inter';
}

function layerStyle(cfg,defaults={}){
  const c={...defaults,...asObj(cfg)};
  const fontRatio=clamp(c.font_size_ratio,.012,.09,.03);
  const bgEnabled=c.background_enabled===true||c.background===true;

  return [
    `left:${pct(c.position_x_percent,50)}%`,
    `top:${pct(c.position_y_percent,50)}%`,
    'transform:translate(-50%,-50%)',
    `width:${pct(c.max_width_percent,86)}%`,
    `color:${cssColor(c.color,'#ffffff')}`,
    `font-size:${Math.max(9,Math.round(fontRatio*390))}px`,
    `font-weight:${clamp(c.font_weight,300,900,700)}`,
    `font-family:"${cssFont(c.font_family)}",sans-serif`,
    bgEnabled?`background:${cssColor(c.background_color,'#111827')}`:'',
    bgEnabled?'padding:5px 8px':'',
    bgEnabled?'border-radius:6px':'',
    `text-shadow:0 1px ${Math.max(1,Number(c.outline_width_px||2))}px ${cssColor(c.outline_color,'#000000')}`
  ].filter(Boolean).join(';');
}

function mockVideoHtml(){
  return `
    <div class="preset-video-placeholder-inner">
      <div class="preset-fake-person person-left"></div>
      <div class="preset-fake-person person-center"></div>
      <div class="preset-fake-person person-right"></div>
      <div class="preset-wave-line"></div>
      <div class="preset-video-label">SOURCE VIDEO</div>
    </div>
  `;
}

function render(){
  try{
    const host=$('preset-live-preview-stage');
    const meta=$('preset-live-preview-meta');
    const error=$('preset-live-preview-error');
    if(!host||!meta||!error) return;

    const loaded=rawPreset();
    if(Object.keys(dynamicComposition(loaded.json)).length){
      renderDynamic(host,meta,loaded.json,loaded.source);
      if(loaded.error){
        error.textContent=loaded.error;
        error.hidden=false;
      }else{
        error.textContent='';
        error.hidden=true;
      }
      return;
    }
    const style=unwrapPreset(loaded.json);
    const video={...asObj(style.base_geometry),...asObj(style.video_config)};
    const hook={...asObj(style.hook_config)};
    const captions={...asObj(style.caption_config)};
    const cta={...asObj(style.cta_config)};

    const layout=text(style.layout_preset||style.default_layout||style.template_id||loaded.json?.template_id||'full_frame');
    const fit=text(video.fit||style.fit||'contain');
    const background=cssColor(video.background_color||style.background_color,'#09090b');

    let videoX=pct(video.x_percent,0);
    let videoY=pct(video.y_percent,0);
    let videoW=pct(video.width_percent,100);
    let videoH=pct(video.height_percent,100);

    const topVideoLayout=
      (layout.includes('top')&&layout.includes('cta'))||
      text(style.template_id).includes('top_video_bottom_cta')||
      text(loaded.json?.template_id).includes('top_video_bottom_cta');

    if(topVideoLayout){
      if(!Number.isFinite(Number(video.x_percent))) videoX=0;
      if(!Number.isFinite(Number(video.y_percent))) videoY=0;
      if(!Number.isFinite(Number(video.width_percent))) videoW=100;
      if(!Number.isFinite(Number(video.height_percent))) videoH=58;
    }

    const hookEnabled=
      style.show_hook_title===true||
      hook.enabled===true||
      Boolean(text(style.hook_text_override||hook.text));

    const captionStyle=text(style.caption_style||captions.style||'none');
    const captionEnabled=
      style.captions_enabled===true||
      captions.enabled===true||
      (captionStyle&&captionStyle!=='none');

    const ctaText=text(style.cta_text||cta.text);
    const ctaEnabled=style.cta_enabled===true||cta.enabled===true||Boolean(ctaText);

    const hookText=text(style.hook_text_override||hook.text)||'YOUR HOOK / HEADLINE';
    const captionText='This is how your captions will appear';
    const finalCta=ctaText||'WATCH THE FULL TRAINING';
    const extraLayers=(Array.isArray(style.text_layers)?style.text_layers:[]).slice(0,5);

    host.style.background=background;
    host.innerHTML=`
      <div class="preset-safe-zone"></div>

      <div class="preset-video-placeholder"
           style="left:${videoX}%;top:${videoY}%;width:${videoW}%;height:${videoH}%">
        ${mockVideoHtml()}
      </div>

      ${hookEnabled?`
        <div class="preset-text-layer preset-hook-layer"
             style="${layerStyle(hook,{
               position_x_percent:50,
               position_y_percent:14,
               max_width_percent:86,
               font_size_ratio:.035,
               font_weight:800,
               color:'#ffffff',
               outline_color:'#000000'
             })}">
          ${esc(hookText)}
        </div>
      `:''}

      ${captionEnabled?`
        <div class="preset-text-layer preset-caption-layer"
             style="${layerStyle(captions,{
               position_x_percent:50,
               position_y_percent:72,
               max_width_percent:84,
               font_size_ratio:.026,
               font_weight:700,
               color:'#ffffff',
               outline_color:'#000000'
             })}">
          <span>${esc(captionText)}</span>
        </div>
      `:''}

      ${ctaEnabled?`
        <div class="preset-text-layer preset-cta-layer"
             style="${layerStyle(cta,{
               position_x_percent:50,
               position_y_percent:86,
               max_width_percent:82,
               font_size_ratio:.025,
               font_weight:800,
               color:'#ffffff',
               background_enabled:true,
               background_color:'#18181b'
             })}">
          ${esc(finalCta)}
        </div>
      `:''}

      ${extraLayers.map((layer,index)=>`
        <div class="preset-text-layer preset-extra-layer"
             style="${layerStyle(layer,{
               position_x_percent:50,
               position_y_percent:48+index*7,
               max_width_percent:86,
               font_size_ratio:.028,
               color:'#ffffff'
             })}">
          ${esc(text(layer.text)||('Text layer '+(index+1)))}
        </div>
      `).join('')}
    `;

    if(loaded.error){
      error.textContent=loaded.error;
      if(error.hidden) error.hidden=false;
    }else{
      error.textContent='';
      if(!error.hidden) error.hidden=true;
    }

    const font=text(captions.font_family||hook.font_family||cta.font_family||'Inter');
    const chips=[
      ['Source',loaded.source],
      ['Layout',layout||'full_frame'],
      ['Fit',fit||'contain'],
      ['Hook',hookEnabled?'On':'Off'],
      ['Captions',captionEnabled?'On':'Off'],
      ['CTA',ctaEnabled?'On':'Off'],
      ['Font',font],
      ['Renderer',text(style.renderer_contract_version||loaded.json?.renderer_contract_version||'13.6')]
    ];

    meta.innerHTML=chips
      .map(([label,value])=>`<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`)
      .join('');
  }catch(error){
    console.error('Preset preview render failed:',error);
    const errorBox=$('preset-live-preview-error');
    if(errorBox){
      errorBox.textContent='Preview error: '+error.message;
      errorBox.hidden=false;
    }
  }
}

function inject(){
  const form=$('create-preset-form');
  const grid=form?.querySelector('.form-modal-grid');

  if(!form||!grid) return false;
  if($('preset-live-preview')) return true;

  form.classList.add('preset-builder-form');

  const aside=document.createElement('aside');
  aside.id='preset-live-preview';
  aside.className='preset-live-preview';
  aside.innerHTML=`
    <div class="preset-preview-head">
      <div>
        <span class="eyebrow-small">LIVE DESIGN PREVIEW</span>
        <h4>Renderer Mockup</h4>
      </div>
      <span class="mini-chip">9:16</span>
    </div>

    <p class="preset-preview-help">
      Safe visual simulation from the preset JSON. It does not call the renderer and does not need a real video.
    </p>

    <div class="preset-phone-frame">
      <div id="preset-live-preview-stage" class="preset-live-preview-stage"></div>
    </div>

    <div id="preset-live-preview-error" class="preset-preview-error" hidden></div>
    <div id="preset-live-preview-meta" class="preset-live-preview-meta"></div>

    <div class="preset-preview-actions">
      <button id="preset-load-base-json" class="secondary-btn" type="button">Load base JSON</button>
      <button id="preset-clear-json" class="text-btn" type="button">Use base preset</button>
    </div>
  `;

  grid.insertAdjacentElement('afterend',aside);

  $('preset-load-base-json')?.addEventListener('click',()=>{
    if($('preset-base')?.value==='__dynamic_v14__'){
      $('preset-json').value=JSON.stringify(starterPreset(),null,2);
      render();
      return;
    }
    const base=selectedBase();
    if(!base?.preset_json) return;
    $('preset-json').value=JSON.stringify(base.preset_json,null,2);
    render();
  });

  $('preset-clear-json')?.addEventListener('click',()=>{
    $('preset-json').value='';
    render();
  });

  $('preset-base')?.addEventListener('change',render);
  $('preset-json')?.addEventListener('input',render);
  $('preset-name')?.addEventListener('input',render);

  render();
  return true;
}

function open(){
  if(!inject()) return;
  render();
}

function reset(){
  if(!inject()) return;
  const error=$('preset-live-preview-error');
  if(error){
    error.textContent='';
    error.hidden=true;
  }
  render();
}

function previewPreset(slug){
  if(!inject()) return;

  const preset=(state.presets?.presets||[]).find(p=>String(p.slug)===String(slug));
  if(!preset) return;

  const base=$('preset-base');
  if(base && [...base.options].some(option=>String(option.value)===String(slug))){
    base.value=slug;
  }

  if($('preset-json')) $('preset-json').value='';
  if($('preset-name')&&!$('preset-name').value) $('preset-name').value=(preset.name||'')+' Copy';

  render();

  $('preset-live-preview')?.scrollIntoView({
    behavior:'smooth',
    block:'center'
  });
}

document.addEventListener('click',event=>{
  const openButton=event.target.closest('#open-presets');
  if(openButton){
    // app.js populates the select and opens the modal first.
    requestAnimationFrame(()=>requestAnimationFrame(open));
    return;
  }

  const designButton=event.target.closest('.preset-design-preview');
  if(designButton){
    event.preventDefault();
    previewPreset(designButton.dataset.slug);
  }
});

document.addEventListener('reset',event=>{
  if(event.target?.id==='create-preset-form'){
    setTimeout(reset,0);
  }
});

inject();

window.__alchemicPresetPreview={
  inject,
  render,
  open,
  reset,
  previewPreset,
  starterPreset
};
