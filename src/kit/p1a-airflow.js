/* Horizontal flow measured in scene units per second. Transport uses raw
   velocity, while flexible surfaces saturate smoothly as the wind increases. */
(function (K) {
  const P = K.procedural || K.authoring;
  const calm = Object.freeze([0, 0]);
  const packedFlag = 8192;
  const mean = 0.5, first = 0.34, second = 0.16, harmonic = 1.81, shift = 0.85;

  function frame(wind = calm) {
    if (!Array.isArray(wind) || wind.length !== 2 || ![wind[0], wind[1]].every(value => Number.isFinite(value) && Math.abs(value) <= 20))
      throw new Error('Wind needs two finite horizontal components in [-20, 20]');
    const [x, z] = wind, scale = 1 / (1 + Math.hypot(x, z));
    return { velocity: [x, z], flex: [x * scale, z * scale] };
  }

  function bend(time, phase, frequency, reach) {
    const wave = time * frequency + phase;
    return reach * (mean + first * Math.sin(wave) + second * Math.sin(wave * harmonic + shift));
  }

  const glsl = `
float airflowBend(float time, float phase, float frequency, float reach) {
  float wave = time * frequency + phase;
  return reach * (${mean} + ${first} * sin(wave) + ${second} * sin(wave * ${harmonic} + ${shift}));
}
`;
  P.airflow = Object.freeze({ frame, bend, packedFlag, glsl });
})(KIT);
