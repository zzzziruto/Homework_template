// Clockwise motion is positive in screen coordinates. Normalize at the ±π seam.
export function rotationDelta(previous,current){
 return Math.atan2(Math.sin(current-previous),Math.cos(current-previous));
}
export function rotatedGain(gain,radians){
 return Math.max(-12,Math.min(12,gain+radians*180/Math.PI*12/135));
}
