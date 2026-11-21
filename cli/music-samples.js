const fs = require('node:fs');
const path = require('node:path');
const WAV = require('./wav.js');
const {json} = require('./asset-files.js');
const {openSampleLibrary} = require('./sample-library.js');
const {readGraphProject} = require('./graph-project.js');
const {readSceneAudio} = require('./scene-audio.js');
const {assetPaths} = require('./music-production.js');
const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
const text = value => typeof value==='string' && value.trim().length>0;

function capture(file, recipe, kit) {
  const {input,sample,provenance} = recipe ?? {};
  if (!input || !text(input.path) || !['file','graph','instrument','world','stem'].includes(input.kind) ||
      provenance!==undefined && input.kind!=='file')
    throw new TypeError('Choose a WAV, graph output, production instrument, world source or soundtrack stem');
  const {KIT:K}=kit, {takeTime:T,mediaGraph:A} = K.procedural;
  const target = path.resolve(path.dirname(file),input.path), reference = input.path;
  const source = {kind:input.kind,name:path.basename(target),reference};
  let audio;
  if (input.kind==='file') audio = WAV.read(target);
  else if (input.kind==='graph') {
    if (!text(input.output)) throw new TypeError('Graph capture needs a named audio output');
    const {outputs,report} = readGraphProject(target,{kit}).run({time:input.time,seed:input.seed,inputs:input.inputs});
    if (!report.passed || !Object.hasOwn(outputs,input.output)) throw new Error('Graph capture output is unavailable');
    audio = outputs[input.output];
    source.name = input.output;
  } else if (input.kind==='instrument') {
    if (!text(input.track)) throw new TypeError('Instrument capture needs a named production track');
    const production = read(target), assets = Object.fromEntries(Object.entries(assetPaths(production,target))
      .map(([name,at])=>[name,WAV.read(at)]));
    const {report,stems} = K.music.production.render(production.production ?? production,assets,
      {start:input.from,end:input.to,sampleRate:input.sampleRate,stems:true});
    if (!Object.hasOwn(stems,input.track)) throw new RangeError('Unknown production audio track '+input.track);
    audio = stems[input.track];
    let peak = 1;
    for (const value of audio.samples) peak = Math.max(peak,Math.abs(value));
    source.gain = 1/peak;
    if (peak > 1) for (let i=0;i<audio.samples.length;i++) audio.samples[i] *= source.gain;
    Object.assign(source,{name:input.track,firstSample:report.firstSample,endSample:report.endSample});
  } else {
    if (input.to===undefined) throw new TypeError('Scene capture needs an end time');
    const by = input.emitter!==undefined ? 'emitter' : 'cue';
    if (input.kind==='world' && (input.emitter!==undefined && input.cue!==undefined || !text(input[by])))
      throw new TypeError('World capture needs one emitter or cue');
    const name = input.kind==='stem' ? input.stem : input[by];
    const selector = {kind:input.kind,name,...(input.kind==='world' && {by})};
    const program = readSceneAudio(target,{kit});
    const {value,report} = program.capture({startPoint:T.read(input.from ?? 0),endPoint:T.read(input.to)}, {source:selector});
    audio = value;
    Object.assign(source,{name,firstSample:report.firstSample,endSample:report.endSample,gain:report.headroom});
  }
  return A.sampleCatalog.capture(audio,{sample,source:provenance ?? source,
    firstSample:input.firstSample,endSample:input.endSample});
}

module.exports = function command([mode,directory,file],opt,kit) {
  if (!directory) throw new TypeError('Use music samples add, search or get with a library directory');
  const library = openSampleLibrary(directory,{kit});
  let value;
  if (mode==='add' && file) value = library.add(capture(file,read(file),kit));
  else if (mode==='search') value = library.search(file ? read(file) : undefined);
  else if (mode==='get' && file) value = library.get(file);
  else throw new TypeError('Sample add needs a recipe, and sample get needs an ID');
  if (typeof opt.out==='string') json(path.resolve(opt.out),value);
  else process.stdout.write(JSON.stringify(value,null,2)+'\n');
  return value;
};
