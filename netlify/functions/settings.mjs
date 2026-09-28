import { authUpdateUser, jsonResponse, publicError, requireWorkspace, supabaseRequest } from './_shared.mjs';

export default async (request) => {
  try {
    const {user,profile,workspace,membership,accessToken}=await requireWorkspace(request);

    if(request.method==='GET'){
      return jsonResponse({
        user:{id:user.id,email:user.email},
        profile,
        workspace,
        membership
      });
    }

    if(request.method!=='POST') return jsonResponse({error:'Method not allowed'},405);

    const input=await request.json();
    const now=new Date().toISOString();

    let updatedProfile=profile;
    let updatedWorkspace=workspace;

    const fullName=input.fullName!==undefined ? String(input.fullName||'').trim() : null;
    if(fullName!==null){
      const rows=await supabaseRequest(
        'app_users?user_id=eq.'+encodeURIComponent(user.id),
        {method:'PATCH',headers:{Prefer:'return=representation'},body:{full_name:fullName||null,updated_at:now}}
      );
      updatedProfile=rows?.[0]||{...profile,full_name:fullName||null};
    }

    const workspaceName=input.workspaceName!==undefined ? String(input.workspaceName||'').trim() : null;
    if(workspaceName!==null && workspace?.id){
      const canEdit=['owner','admin'].includes(membership?.role||profile?.role);
      if(!canEdit) return jsonResponse({error:'Only workspace owners and admins can rename the workspace'},403);
      if(!workspaceName) return jsonResponse({error:'Workspace name cannot be empty'},400);

      const rows=await supabaseRequest(
        'media_workspaces?id=eq.'+encodeURIComponent(workspace.id),
        {method:'PATCH',headers:{Prefer:'return=representation'},body:{name:workspaceName,updated_at:now}}
      );
      updatedWorkspace=rows?.[0]||{...workspace,name:workspaceName};
    }

    const password=String(input.newPassword||'');
    if(password){
      if(password.length<8) return jsonResponse({error:'Password must be at least 8 characters'},400);
      await authUpdateUser(accessToken,{password});
    }

    return jsonResponse({
      ok:true,
      profile:updatedProfile,
      workspace:updatedWorkspace,
      password_changed:Boolean(password)
    });
  } catch(error){
    return publicError(error,error.status||500);
  }
};
