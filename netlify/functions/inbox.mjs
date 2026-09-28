import { jsonResponse, publicError, requireUser, supabaseRequest } from './_shared.mjs';

export default async (request) => {
  try {
    await requireUser(request);
    const url=new URL(request.url);
    const limit=Math.min(200,Math.max(1,Number(url.searchParams.get('limit')||100)));
    const offset=Math.max(0,Number(url.searchParams.get('offset')||0));

    const social=await supabaseRequest(
      `v_social_inbox?select=*&order=last_message_at.desc.nullslast&limit=${limit}&offset=${offset}`
    ).catch(()=>[]);

    return jsonResponse({social:social||[]});
  } catch(error){
    return publicError(error,error.status||500);
  }
};
