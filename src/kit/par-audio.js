/* Headless typed ports shared by WAV assets, native audio analysis and event replay. */
(function (P) {
  const A = P.mediaGraph;
  const options = { type: 'record', default: {} };
  function mediaTime(time, take, settings) {
    const local = ['time', 'frame', 'fps', 'origin'].some(key => Object.hasOwn(settings, key));
    return { time, ...(!local && take !== undefined && { take }), ...settings };
  }
  const media = (outputs, sample) => ({ inputs: { source: 'audio', options }, outputs, time: true,
    run({ source, options }, { time, take }) { return sample(source, mediaTime(time, take, options)); }
  });
  A.operations = Object.freeze({
    'audio.buffer': {
      inputs: { sampleRate: 'number', channels: 'number', samples: 'array<number>' }, outputs: { value: 'audio' },
      run(input) { return { value: A.audio(input) }; }
    },
    'audio.window': media({ value: 'audio', report: 'record' }, A.audioWindow),
    'audio.analyze': media({ value: 'record', rms: 'number', peak: 'number' }, A.analyze),
    'audio.fft': media({ value: 'record', spectrum: 'raster', bands: 'record' }, A.fft),
    'audio.series': {
      inputs: { source: 'audio', options }, outputs: { value: 'array<record>' },
      run({ source, options }) { return { value: A.series(source, options) }; }
    },
    'input.recording': {
      inputs: { initial: options, events: 'array<record>' }, outputs: { value: 'record' },
      run(inputs) { return { value: A.recording(inputs) }; }
    },
    'input.replay': {
      inputs: { source: 'record', options }, outputs: { value: 'record', events: 'array<record>', pulses: 'array<record>', report: 'record' },
      time: true, instantiate() {
        let prior, replay;
        return ({ source, options }, { time, take }) => {
          if (source !== prior) {
            replay = A.inputReplay(source);
            prior = source;
          }
          return replay.sample(mediaTime(time, take, options));
        };
      }
    },
    'input.actions': {
      inputs: { state: 'record', contexts: 'record', context: 'string' }, outputs: { value: 'record' },
      run({ state, contexts, context }) { return { value: A.actions(state, contexts, context) }; }
    }
  });
  delete P.mediaGraphSupport;
})(KIT.procedural);
