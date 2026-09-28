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

function selectedBase(){
  const slug=$('preset-base')?.value;
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
  previewPreset
};
