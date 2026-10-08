export function campaignGroupKey(campaign){
  const explicit=String(campaign?.metadata?.campaign_group||'').toLowerCase();
  if(['alchemic','zach','whoop'].includes(explicit)) return explicit;
  const hay=[campaign?.slug,campaign?.name,campaign?.metadata?.client].filter(Boolean).join(' ').toLowerCase();
  if(/\b(alchemic|alchemix)\b/.test(hay)) return 'alchemic';
  if(/\b(zach|zack)\b/.test(hay)) return 'zach';
  return 'whoop';
}
