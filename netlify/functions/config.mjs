import { callbacks, jsonResponse, providerConfig, publicError } from './_shared.mjs';

export default async (request) => {
  try {
    return jsonResponse({
      providers:providerConfig(),
      callbacks:callbacks(request),
      instagramApiVersion:process.env.INSTAGRAM_API_VERSION?.trim()||'v26.0',
      previewMode:true
    });
  } catch(error){
    return publicError(error,error.status||500);
  }
};
