import test from 'node:test';
import assert from 'node:assert/strict';
import { readAllRows, loadMetricData, loadLatestMetrics } from '../netlify/functions/_analytics-read.mjs';
import { loadContentData } from '../netlify/functions/content-data.mjs';

test('analytics reads past the server row cap without changing workspace or ordering',async()=>{
  const data=Array.from({length:1607},(_,id)=>({id}));
  const calls=[];
  const db=async path=>{
    const params=new URLSearchParams(path.split('?')[1]);calls.push(params);
    assert.equal(params.get('workspace_id'),'eq.workspace');
    assert.equal(params.get('order'),'captured_at.asc,id.asc');
    return data.slice(Number(params.get('offset')),Number(params.get('offset'))+Math.min(1000,Number(params.get('limit'))));
  };
  const result=await readAllRows('post_metrics_snapshots?workspace_id=eq.workspace&order=captured_at.asc,id.asc&limit=30000',{db});
  assert.equal(result.length,1607);assert.equal(result.at(-1).id,1606);
  assert.deepEqual(calls.map(x=>Number(x.get('offset'))),[0,500,1000,1500,2000]);
});

test('missing SQL views use every snapshot page and retain current counts',async()=>{
  const samples=Array.from({length:1101},(_,i)=>({id:i,history_id:'history',views:i,captured_at:String(i)}));
  const db=async path=>{
    if(path.startsWith('v_media_')) throw Object.assign(new Error('v_media_ missing from schema cache'),{status:404});
    const p=new URLSearchParams(path.split('?')[1]);
    return samples.slice(Number(p.get('offset')),Number(p.get('offset'))+Number(p.get('limit')));
  };
  const result=await loadMetricData('workspace',db);
  assert.equal(result.latest[0].views,1100);assert.equal(result.samples.length,1101);
  assert.equal((await loadLatestMetrics('workspace',db))[0].views,1100);
});

test('database failures surface instead of turning analytics into zero counts',async()=>{
  await assert.rejects(loadMetricData('workspace',async()=>{throw Object.assign(new Error('Database unavailable'),{status:500});}),/Database unavailable/);
});

function fixtureDb({views=false}={}){
  const history=[{id:'h',queue_id:'q',account_id:'a',platform:'instagram_reels',event_type:'published'}];
  const samples=[
    {id:1,history_id:'h',captured_at:'2026-10-01T00:00:00Z',views:9999,likes:2,comments:1,insights_ok:false},
    {id:2,history_id:'h',captured_at:'2026-10-02T00:00:00Z',views:100,likes:2,comments:1,insights_ok:true},
    {id:3,history_id:'h',captured_at:'2026-10-03T00:00:00Z',views:110,likes:3,comments:1,insights_ok:true},
    {id:4,history_id:'h',captured_at:'2026-10-04T00:00:00Z',views:105,likes:3,comments:1,insights_ok:true},
    {id:5,history_id:'h',captured_at:'2026-10-05T00:00:00Z',views:115,likes:3,comments:2,insights_ok:true}
  ];
  return async path=>{
    const table=path.split('?')[0];
    if(table.startsWith('v_media_')) {
      if(!views) throw Object.assign(new Error(table+' not found in schema cache'),{status:404});
      return table==='v_media_latest_post_metrics'?[samples.at(-1)]:[{history_id:'h',metric_date:'2026-10-03',views:10},{history_id:'h',metric_date:'2026-10-05',views:5}];
    }
    if(table==='content_history'){assert.match(path,/event_type=eq.published/);return history;}
    if(table==='content_publish_queue')return [{id:'q',selected_account_id:'a',platform:'instagram_reels',status:'done',external_post_id:'media',finished_at:'2026-10-01T00:00:00Z'}];
    if(table==='content_accounts')return [{id:'a',platform:'instagram_reels',username:'instagram-account'}];
    if(table==='post_metrics_snapshots')return samples;
    return [];
  };
}

test('Instagram latest totals appear and chart excludes lifetime baseline and count recovery',async()=>{
  const result=await loadContentData('workspace',fixtureDb());
  assert.equal(result.published[0].views,115);assert.equal(result.summary.views,115);
  assert.equal(result.published[0].metrics_status,'ready');
  assert.equal(result.activity_points.reduce((sum,p)=>sum+p.views,0),15);
  assert.equal(result.activity_points.some(p=>p.occurred_at.startsWith('2026-10-02')&&p.views>0),false);
});

test('optimized SQL view results match paginated snapshot totals and growth',async()=>{
  const fallback=await loadContentData('workspace',fixtureDb());
  const optimized=await loadContentData('workspace',fixtureDb({views:true}));
  assert.equal(optimized.summary.views,fallback.summary.views);
  assert.equal(optimized.activity_points.reduce((sum,p)=>sum+p.views,0),fallback.activity_points.reduce((sum,p)=>sum+p.views,0));
  assert.equal(optimized.analytics_source,'database_views');
});
