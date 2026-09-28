const media=window.__alchemic;
if(!media) throw new Error('Alchemic core unavailable');

const {state,esc}=media;
const $=id=>document.getElementById(id);

const asObj=value=>{
  if(value&&typeof value==='object'&&!Array.isArray(value)) return value;
  if(typeof value==='string'){try{return JSON.parse(value)}catch{}}
  return {};
};
const pct=(value,fallback)=>Math.max(0,Math.min(100,Number.isFinite(Number(value))?Number(value):fallback));
const clamp=(value,min,max,fallback)=>Math.max(min,Math.min(max,Number.isFinite(Number(value))?Number(value):fallback));
const text=value=>String(value??'').trim();

function selectedBase(){
  const slug=$('preset-base')?.value;
  return (state.presets?.presets||[]).find(p=>p.slug===slug)||null;
}

function rawPreset(){
  const raw=$('preset-json')?.value?.trim()||'';
  if(raw){
    try{return {json:JSON.parse(raw),source:'custom JSON',error:null}}
    catch(error){return {json:selectedBase()?.preset_json||{},source:'base preset',error:error.message}}
  }
  return {json:selectedBase()?.preset_json||{},source:selectedBase()?.name||'base preset',error:null};
}

function unwrapPreset(raw){
  const root=asObj(raw);
  if(Array.isArray(root.styles)&&root.styles.length) return asObj(root.styles[0]);
  if(Array.isArray(root.resolved_styles)&&root.resolved_styles.length) return asObj(root.resolved_styles[0]);
  if(Object.keys(asObj(root.template_style)).length) return asObj(root.template_style);
  if(Object.keys(asObj(root.style)).length) return asObj(root.style);
  return root;
}

function color(value,fallback){
  const v=text(value);
  return /^#[0-9a-f]{3,8}$/i.test(v)||/^rgba?\(/i.test(v)?v:fallback;
}

function layerStyle(cfg,defaults={}){
  const c={...defaults,...asObj(cfg)};
  const fontRatio=clamp(c.font_size_ratio,.012,.09,.03);
  return [
    `left:${pct(c.position_x_percent,50)}%`,
    `top:${pct(c.position_y_percent,50)}%`,
    'transform:translate(-50%,-50%)',
    `width:${pct(c.max_width_percent,86)}%`,
    `color:${color(c.color,'#ffffff')}`,
    `font-size:${Math.max(9,Math.round(fontRatio*390))}px`,
    `font-weight:${clamp(c.font_weight,300,900,700)}`,
    `font-family:${esc(text(c.font_family)||'Inter')},sans-serif`,
    c.background_enabled===true?`background:${color(c.background_color,'#111827')}`:'',
    c.background_enabled===true?`padding:5px 8px`:'',
    c.background_enabled===true?'border-radius:6px':'',
    `text-shadow:0 1px ${Math.max(1,Number(c.outline_width_px||2))}px ${color(c.outline_color,'#000000')}`
  ].filter(Boolean).join(';');
}

function mockVideoHtml(){
  return `
    <div class="preset-video-placeholder-inner">
      <div class="preset-fake-person person-left"><span></span></div>
      <div class="preset-fake-person person-center"><span></span></div>
      <div class="preset-fake-person person-right"><span></span></div>
      <div class="preset-wave-line"></div>
      <div class="preset-video-label">SOURCE VIDEO</div>
    </div>
  `;
}

function render(){
  const host=$('preset-live-preview-stage');
  const meta=$('preset-live-preview-meta');
  const error=$('preset-live-preview-error');
  if(!host||!meta) return;

  const loaded=rawPreset();
  const style=unwrapPreset(loaded.json);
  const video={...asObj(style.base_geometry),...asObj(style.video_config)};
  const hook={...asObj(style.hook_config)};
  const captions={...asObj(style.caption_config)};
  const cta={...asObj(style.cta_config)};
  const layout=text(style.layout_preset||style.default_layout||style.template_id||'full_frame');
  const fit=text(video.fit||style.fit||'contain');
  const background=color(video.background_color||style.background_color,'#09090b');

  let videoX=pct(video.x_percent,0);
  let videoY=pct(video.y_percent,0);
  let videoW=pct(video.width_percent,100);
  let videoH=pct(video.height_percent,100);

  if((layout.includes('top')&&layout.includes('cta')) || text(style.template_id).includes('top_video_bottom_cta')){
    if(!Number.isFinite(Number(video.y_percent))) videoY=6;
    if(!Number.isFinite(Number(video.height_percent))) videoH=42;
  }

  const hookEnabled=style.show_hook_title===true||hook.enabled===true;
  const captionEnabled=style.captions_enabled===true&&text(style.caption_style||'none')!=='none';
  const ctaText=text(style.cta_text||cta.text);
  const ctaEnabled=style.cta_enabled===true||cta.enabled===true||Boolean(ctaText);

  const hookText=text(style.hook_text_override||hook.text)||'YOUR HOOK / HEADLINE';
  const captionText='This is how your captions will appear';
  const finalCta=ctaText||'WATCH THE FULL TRAINING';

  const extraLayers=(Array.isArray(style.text_layers)?style.text_layers:[]).slice(0,5);

  host.style.background=background;
  host.innerHTML=`
    <div class="preset-safe-zone"></div>
    <div class="preset-video-placeholder" style="left:${videoX}%;top:${videoY}%;width:${videoW}%;height:${videoH}%">
      ${mockVideoHtml()}
    </div>

    ${hookEnabled?`<div class="preset-text-layer preset-hook-layer" style="${layerStyle(hook,{position_x_percent:50,position_y_percent:14,max_width_percent:86,font_size_ratio:.035,font_weight:800,color:'#ffffff',outline_color:'#000000'})}">${esc(hookText)}</div>`:''}

    ${captionEnabled?`<div class="preset-text-layer preset-caption-layer" style="${layerStyle(captions,{position_x_percent:50,position_y_percent:72,max_width_percent:84,font_size_ratio:.026,font_weight:700,color:'#ffffff',outline_color:'#000000'})}"><span>${esc(captionText)}</span></div>`:''}

    ${ctaEnabled?`<div class="preset-text-layer preset-cta-layer" style="${layerStyle(cta,{position_x_percent:50,position_y_percent:86,max_width_percent:82,font_size_ratio:.025,font_weight:800,color:'#ffffff',background_enabled:true,background_color:'#18181b'})}">${esc(finalCta)}</div>`:''}

    ${extraLayers.map((layer,index)=>`<div class="preset-text-layer preset-extra-layer" style="${layerStyle(layer,{position_x_percent:50,position_y_percent:48+index*7,max_width_percent:86,font_size_ratio:.028,color:'#ffffff'})}">${esc(text(layer.text)||('Text layer '+(index+1)))}</div>`).join('')}
  `;

  error.textContent=loaded.error?'JSON error: '+loaded.error:'';
  error.hidden=!loaded.error;

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
  meta.innerHTML=chips.map(([label,value])=>`<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
}

function inject(){
  const form=$('create-preset-form');
  const grid=form?.querySelector('.form-modal-grid');
  if(!form||!grid||$('preset-live-preview')) return;

  form.classList.add('preset-builder-form');

  const aside=document.createElement('aside');
  aside.id='preset-live-preview';
  aside.className='preset-live-preview';
  aside.innerHTML=`
    <div class="preset-preview-head">
      <div><span class="eyebrow-small">LIVE DESIGN PREVIEW</span><h4>Renderer Mockup</h4></div>
      <span class="mini-chip">9:16</span>
    </div>
    <p class="preset-preview-help">A visual simulation of the preset JSON. It shows layout and typography, not a real render.</p>
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

  $('preset-load-base-json').onclick=()=>{
    const base=selectedBase();
    if(!base?.preset_json) return;
    $('preset-json').value=JSON.stringify(base.preset_json,null,2);
    render();
  };
  $('preset-clear-json').onclick=()=>{
    $('preset-json').value='';
    render();
  };

  $('preset-base')?.addEventListener('change',render);
  $('preset-json')?.addEventListener('input',render);
  $('preset-name')?.addEventListener('input',render);
  render();
}

const observer=new MutationObserver(()=>{
  inject();
  if(!$('presets-modal')?.hidden) render();
});
observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden']});

inject();

document.addEventListener('click',event=>{
  if(event.target.closest('#open-presets')) setTimeout(()=>{inject();render()},30);
});

window.__alchemicPresetPreview={render};
