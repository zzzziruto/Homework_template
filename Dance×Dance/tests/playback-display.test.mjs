import test from 'node:test';
import assert from 'node:assert/strict';
import {formatMediaTime,formatTrackProgress} from '../audio/playback-display.mjs';
test('track times show elapsed song seconds and original duration with zero-padded seconds',()=>{
 assert.equal(formatTrackProgress(0,294.504475),'0:00 / 4:54');
 assert.equal(formatTrackProgress(67.9,294.504475),'1:07 / 4:54');
 assert.equal(formatTrackProgress(294.504475,294.504475),'4:54 / 4:54');
 assert.equal(formatMediaTime(3605),'60:05');
});
test('unknown metadata and scratch boundary positions never produce invalid or overflowing times',()=>{
 assert.equal(formatTrackProgress(-2,294.5),'0:00 / 4:54');
 assert.equal(formatTrackProgress(999,294.5),'4:54 / 4:54');
 assert.equal(formatTrackProgress(NaN,294.5),'0:00 / 4:54');
 assert.equal(formatTrackProgress(12,Infinity),'0:12 / --:--');
 assert.equal(formatTrackProgress(0,NaN),'0:00 / --:--');
});
