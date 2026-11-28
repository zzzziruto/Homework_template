export function loadLocalTrack(elements,url,{timeoutMs=15000,signal}={}){
 return Promise.all(elements.map(audio=>new Promise((resolve,reject)=>{
  let timer;
  const clear=()=>{clearTimeout(timer);audio.removeEventListener('loadedmetadata',loaded);audio.removeEventListener('error',failed);signal?.removeEventListener('abort',failed);};
  const loaded=()=>{clear();resolve();};
  const failed=()=>{clear();reject(new Error('음원을 준비하지 못했어요. 다시 시도해주세요.'));};
  audio.addEventListener('loadedmetadata',loaded);audio.addEventListener('error',failed);
  if(signal?.aborted){failed();return;}signal?.addEventListener('abort',failed,{once:true});
  timer=setTimeout(failed,timeoutMs);audio.src=url;audio.load();
 })));
}
