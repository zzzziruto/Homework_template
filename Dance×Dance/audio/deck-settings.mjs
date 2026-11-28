export const TEST_TRACK=Object.freeze({id:'bad-romance',title:'Bad Romance',artist:'Lady Gaga',src:new URL('../music/Bad Romance_Lady Gaga_The Fame Monster (International Deluxe).mp3',import.meta.url).href,bpm:119,duration:294.504475});
export class DeckSettings {
 constructor(track=TEST_TRACK){this.selectTrack(track);}
 selectTrack(track){if(!track||!Number.isFinite(track.bpm)||track.bpm<=0)throw new Error('곡의 원래 BPM을 확인해주세요.');this.track=track;this.tempo=1;}
 setTempo(rate){if(!Number.isFinite(rate))throw new Error('템포 값이 올바르지 않아요.');this.tempo=Math.max(.75,Math.min(1.25,rate));return this.tempo;}
 get bpm(){return this.track.bpm*this.tempo;}
 get formattedBpm(){return this.bpm.toFixed(2);}
}
