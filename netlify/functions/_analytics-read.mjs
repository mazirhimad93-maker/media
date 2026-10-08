import { scopedPath, supabaseRequest } from './_shared.mjs';

// A large ?limit= does not override PostgREST's server row cap.
// Every page stays below that cap and has a deterministic caller-supplied order.
export async function readAllRows(path, {db=supabaseRequest, pageSize=500, maxRows=100000}={}) {
  const [table, query='']=path.split('?');
  const params=new URLSearchParams(query);
  params.delete('limit'); params.delete('offset');
  const rows=[];
  const pageAt=offset=>{
    const query=new URLSearchParams(params);
    query.set('offset',String(offset)); query.set('limit',String(pageSize));
    return db(table+'?'+query);
  };
  const append=page=>{
    if(!Array.isArray(page)) throw new Error('Invalid analytics database response.');
    if(rows.length+page.length>maxRows) throw new Error('Analytics row budget exceeded; install the analytics SQL views.');
    rows.push(...page);
    return page.length<pageSize;
  };
  if(append(await pageAt(0))) return rows;
  for(let offset=pageSize;offset<=maxRows;offset+=4*pageSize){
    const count=Math.min(4,Math.floor((maxRows-offset)/pageSize)+1);
    const pages=await Promise.allSettled(Array.from({length:count},(_,i)=>pageAt(offset+i*pageSize)));
    for(const page of pages){
      if(page.status==='rejected') throw page.reason;
      if(append(page.value)) return rows;
    }
  }
  throw new Error('Analytics row budget exceeded; install the analytics SQL views.');
}

const snapshotFields='id,history_id,workspace_id,captured_at,views,likes,comments,shares,saves,insights_ok:raw_json->insights_ok';
const isMissingView=error=>error.status===404 && /v_media_|schema cache|not find|does not exist/i.test(error.message);

export async function loadMetricData(workspaceId, db=supabaseRequest) {
  try{
    const [latest,growth]=await Promise.all([
      readAllRows(scopedPath('v_media_latest_post_metrics?select=*&order=history_id.asc',workspaceId),{db}),
      readAllRows(scopedPath('v_media_post_metric_growth?select=*&order=metric_date.asc,history_id.asc',workspaceId),{db})
    ]);
    return {latest,growth,samples:[],source:'database_views'};
  }catch(error){
    if(!isMissingView(error)) throw error;
    // The application works before the optional SQL optimization is installed.
    const samples=await readAllRows(scopedPath('post_metrics_snapshots?select='+snapshotFields+'&order=captured_at.asc,id.asc',workspaceId),{db});
    const latest=new Map();
    for(const row of samples) latest.set(row.history_id,row);
    return {latest:[...latest.values()],growth:null,samples,source:'paginated_snapshots'};
  }
}

export async function loadLatestMetrics(workspaceId, db=supabaseRequest) {
  try{
    return await readAllRows(scopedPath('v_media_latest_post_metrics?select=*&order=history_id.asc',workspaceId),{db});
  }catch(error){
    if(!isMissingView(error)) throw error;
    const samples=await readAllRows(scopedPath('post_metrics_snapshots?select='+snapshotFields+'&order=captured_at.asc,id.asc',workspaceId),{db});
    const latest=new Map();
    for(const row of samples) latest.set(row.history_id,row);
    return [...latest.values()];
  }
}
