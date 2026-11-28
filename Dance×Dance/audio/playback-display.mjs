export function formatMediaTime(seconds){
 if(!Number.isFinite(seconds)||seconds<0)return '0:00';
 const whole=Math.floor(seconds);
 return `${Math.floor(whole/60)}:${String(whole%60).padStart(2,'0')}`;
}
export function formatTrackProgress(position,duration){
 const known=Number.isFinite(duration)&&duration>0;
 const safe=Number.isFinite(position)?Math.max(0,position):0;
 const elapsed=known?Math.min(safe,duration):safe;
 return `${formatMediaTime(elapsed)} / ${known?formatMediaTime(duration):'--:--'}`;
}
