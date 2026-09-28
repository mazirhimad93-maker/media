import { jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest } from './_shared.mjs';

export default async (request) => {
  try {
    const { workspaceId } = await requireWorkspace(request);
    if (request.method !== 'GET') throw Object.assign(new Error('GET required'), { status: 405 });
    const accounts = await supabaseRequest(scopedPath('content_accounts?select=id,metadata&limit=5000', workspaceId));
    const ids = (accounts || []).map((a) => a.id);
    if (!ids.length) return jsonResponse({ leads: [] });

    const filter = '&account_id=in.(' + ids.map(encodeURIComponent).join(',') + ')';
    const leads = [];
    for (let offset = 0; offset < 5000; offset += 1000) {
      const page = await supabaseRequest('v_social_inbox?select=conversation_id,contact_id,contact_username,contact_display_name,platform,account_username,lead_status,last_message,last_message_at,last_inbound_at,unread_count' + filter + '&order=last_message_at.desc.nullslast&limit=1000&offset=' + offset);
      leads.push(...(page || []));
      if (!page || page.length < 1000) break;
    }
    return jsonResponse({ leads });
  } catch (error) {
    return publicError(error, error.status || 500);
  }
};
