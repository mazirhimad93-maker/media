import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {campaignGroupKey} from '../netlify/functions/_campaign-groups.mjs';
import {loadCampaigns} from '../netlify/functions/campaigns.mjs';
import {loadContentData} from '../netlify/functions/content-data.mjs';

const context={window:{}};
vm.runInNewContext(fs.readFileSync(new URL('../public/content-filters.js',import.meta.url),'utf8'),context);
const filters=context.window.__alchemicContentFilters;

test('published defaults hide failed and ready attempts but retain an existing published post',()=>{
  assert.equal(filters.matches({status:'done'}),true);
  assert.equal(filters.matches({status:'failed'}),false);
  assert.equal(filters.matches({status:'ready'}),false);
  assert.equal(filters.matches({status:'failed',external_post_id:'existing-post'}),true);
  assert.equal(filters.matches({status:'failed'},{status:'failed'}),true);
  assert.equal(filters.matches({status:'ready'},{status:'all'}),true);
});

test('Today includes local midnight and excludes yesterday, tomorrow, and invalid dates',()=>{
  const now=new Date(2026,9,8,18,19);
  const match=finished_at=>filters.matches({status:'done',finished_at},{date:'1'},now);
  assert.equal(match(new Date(2026,9,8,0,0).toISOString()),true);
  assert.equal(match(new Date(2026,9,7,23,59).toISOString()),false);
  assert.equal(match(new Date(2026,9,9,0,0).toISOString()),false);
  assert.equal(match('invalid-date'),false);
  assert.equal(filters.matches({status:'done',created_at:now.toISOString()},{date:'1'},now),true);
});

test('campaign group filters include every member and exclude other campaigns',()=>{
  const choice={campaign:'group:alchemic',campaignIds:['training','other-alchemic']};
  assert.equal(filters.matches({status:'done',campaign_id:'training'},choice),true);
  assert.equal(filters.matches({status:'done',campaign_id:'other-alchemic'},choice),true);
  assert.equal(filters.matches({status:'done',campaign_id:'whoop'},choice),false);
});

test('campaign groups honor explicit attribution and recognize names away from the beginning',()=>{
  assert.equal(campaignGroupKey({name:'New Alchemic clip batch'}),'alchemic');
  assert.equal(campaignGroupKey({name:'Story Commentary Lab',metadata:{campaign_group:'alchemic'}}),'alchemic');
  assert.equal(campaignGroupKey({name:'Campaign for Zach'}),'zach');
  assert.equal(campaignGroupKey({name:'General clipping'}),'whoop');
});

const campaign={id:'training',name:'Alchemic — Training',status:'active'};
function fixtureDb(path){
  const table=path.split('?')[0];
  if(table==='distribution_campaigns') return Promise.resolve([campaign]);
  if(table==='clip_variants') return Promise.resolve([{id:'variant',campaign_id:'training'}]);
  if(table==='content_assets') return Promise.resolve([{id:'asset',clip_variant_id:'variant'}]);
  if(table==='content_publish_queue') return Promise.resolve([{id:'queue',asset_id:'asset',platform:'instagram_reels',status:'done',external_post_id:'post'}]);
  if(table==='content_history') return Promise.resolve([{id:'history',queue_id:'queue',event_type:'published',created_at:'2026-10-08T09:00:00Z'}]);
  if(table==='v_media_latest_post_metrics') return Promise.resolve([{history_id:'history',views:1692,comments:1,likes:7,insights_ok:true,captured_at:'2026-10-08T18:00:00Z'}]);
  return Promise.resolve([]);
}

test('clipping campaign name and fallback variant attribution reach Content and Alchemic totals',async()=>{
  const content=await loadContentData('workspace',fixtureDb);
  assert.equal(content.rows[0].campaign_id,'training');
  assert.equal(content.rows[0].campaign_name,campaign.name);
  assert.equal(content.campaigns[0].name,campaign.name);
  assert.equal(content.rows[0].comments,1);
  const result=await loadCampaigns('workspace',fixtureDb);
  const group=result.campaigns.find(x=>x.id==='group:alchemic');
  assert.equal(group.published,1);
  assert.equal(group.views,1692);
  assert.equal(group.comments,1);
  assert.equal(result.campaigns.find(x=>x.id==='group:whoop').published,0);
});

test('mobile cards display comments separately from DMs and the rate excludes unavailable metrics',()=>{
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id)) elements.set(id,{value:'all',innerHTML:'',classList:{toggle(){}},querySelectorAll:()=>[],addEventListener(){},cloneNode(){return this;},replaceWith(){}});
    return elements.get(id);
  };
  element('content-status-filter').value='done';
  const document={getElementById:element,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}};
  const state={content:{rows:[
    {queue_id:'published',title:'Published clip',status:'done',views:200,comments:2,primary_result:0,primary_result_label:'DMs',views_available:true},
    {queue_id:'unavailable',title:'Missing stats',status:'done',views:1000,comments:null,views_available:true},
    {queue_id:'failed',title:'Failed attempt',status:'failed',views:null,comments:null}
  ]}};
  const window={__alchemic:{state,esc:String,fmt:String,platformLabel:String,dateShort:()=>''},dispatchEvent(){}};
  const sandbox={window,document,localStorage:{getItem:()=>null},setInterval:()=>0,setTimeout(){},CustomEvent:class{}};
  vm.runInNewContext(fs.readFileSync(new URL('../public/content-filters.js',import.meta.url),'utf8'),sandbox);
  vm.runInNewContext(fs.readFileSync(new URL('../public/content-table.js',import.meta.url),'utf8'),sandbox);
  window.__alchemicContentTable.render();
  assert.match(element('content-mobile-list').innerHTML,/<strong>2<\/strong> comments/);
  assert.match(element('content-mobile-list').innerHTML,/<strong>0<\/strong> DMs/);
  assert.match(element('content-mobile-list').innerHTML,/<strong>—<\/strong> comments/);
  assert.doesNotMatch(element('content-mobile-list').innerHTML,/Failed attempt/);
  assert.match(element('content-summary').innerHTML,/<strong>1.00%<\/strong><span>Comments \/ Views/);
});
