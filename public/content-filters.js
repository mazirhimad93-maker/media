// Shared by the initial app renderer and the enhanced content table.
window.__alchemicContentFilters={
  isPublished:row=>row.status==='done'||Boolean(row.external_post_id||row.external_post_url),
  matches(row,{platform='all',status='done',campaign='all',campaignIds=[],date='all'}={},now=new Date()){
    if(platform!=='all'&&row.platform!==platform) return false;
    if(status==='done'&&!this.isPublished(row)) return false;
    if(status!=='all'&&status!=='done'&&row.status!==status) return false;
    if(campaign!=='all'&&!new Set([campaign,...campaignIds]).has(row.campaign_id)) return false;
    if(date!=='all'){
      const start=new Date(now.getFullYear(),now.getMonth(),now.getDate());
      start.setDate(start.getDate()-(Math.max(1,Number(date))-1));
      const timestamp=new Date(row.finished_at||row.created_at||0).getTime();
      if(!Number.isFinite(timestamp)||timestamp<start.getTime()||timestamp>now.getTime()) return false;
    }
    return true;
  }
};
