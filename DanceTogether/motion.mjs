// Permission must be requested in the original tap handler, before any network await.
export function createMotionSensor(win,{onSample=()=>{},onStatus=()=>{},timeoutMs=6000}={}){
  let enabled=false,pending=null,listener=null,timer=null,rejectPending=null;
  const valid=event=>[event.acceleration,event.accelerationIncludingGravity].some(a=>a&&[a.x,a.y,a.z].every(Number.isFinite));
  function stop(){
    if(listener)win.removeEventListener('devicemotion',listener);
    listener=null;enabled=false;clearTimeout(timer);
    if(rejectPending)rejectPending(new Error('움직임 감지가 중지됐어요. 다시 시작해주세요.'));
    pending=null;rejectPending=null;
  }
  function enable(){
    if(enabled)return Promise.resolve();if(pending)return pending;
    const Motion=win.DeviceMotionEvent;
    if(!win.isSecureContext)return Promise.reject(new Error('공유받은 HTTPS 링크로 다시 열어주세요.'));
    if(!Motion)return Promise.reject(new Error('이 기기는 움직임 센서를 지원하지 않아요. 휴대폰이나 태블릿에서 열어주세요.'));
    let permission;
    try{permission=typeof Motion.requestPermission==='function'?Motion.requestPermission():Promise.resolve('granted');}
    catch{permission=Promise.reject(new Error('움직임 권한을 요청하지 못했어요. 시작하기를 다시 눌러주세요.'));}
    onStatus('checking');
    pending=Promise.resolve(permission).then(granted=>{
      if(granted!=='granted')throw new Error('움직임 접근이 거부됐어요. 이 사이트의 움직임 접근을 허용한 뒤 다시 시작해주세요.');
      return new Promise((resolve,reject)=>{
        rejectPending=reject;
        timer=setTimeout(()=>reject(new Error('센서 신호가 들어오지 않아요. Safari 또는 Chrome에서 링크를 직접 열고 다시 시작해주세요.')),timeoutMs);
        listener=event=>{
          if(!valid(event))return;
          if(!enabled){enabled=true;clearTimeout(timer);rejectPending=null;onStatus('on');resolve();}
          onSample(event);
        };
        win.addEventListener('devicemotion',listener);
      });
    }).catch(error=>{
      if(listener)win.removeEventListener('devicemotion',listener);
      listener=null;enabled=false;clearTimeout(timer);onStatus('off');throw error;
    }).finally(()=>{pending=null;rejectPending=null;});
    return pending;
  }
  return {enable,stop,get enabled(){return enabled;}};
}
