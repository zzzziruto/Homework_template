# SoundTouchJS audio worklet

Unmodified bundled processor from `@soundtouchjs/audio-worklet` version **2.1.1**.

- Source repository: https://github.com/cutterbl/SoundTouchJS/tree/master/packages/audio-worklet
- Exact published source bundle: https://registry.npmjs.org/@soundtouchjs/audio-worklet/-/audio-worklet-2.1.1.tgz
- File in the package: `.dist/soundtouch-processor.js`
- Local file: `soundtouch-processor-2.1.1.js`
- SHA-256: `59635b112697ad403f7aebb46fc5386231d5db06877707afcec19f555b4d68ca`
- License: MPL-2.0, see `SoundTouchJS-LICENSE.txt` and https://www.mozilla.org/en-US/MPL/2.0/

The processor includes its core and interpolation dependencies. It is served locally; no runtime CDN or package installation is required. Dance×Dance uses it to preserve pitch while changing an `AudioBufferSourceNode` playback rate, avoiding Safari's HTML media rate-change stalls.
