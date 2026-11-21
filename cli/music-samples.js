const fs = require('node:fs');
const path = require('node:path');
const WAV = require('./wav.js');
const {json,write} = require('./asset-files.js');
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

function editCommand(mode,file,settings,out,library,tool) {
  if (!file) throw new TypeError('Pass a sample ID or sample edit project');
  if (mode==='slice') {
    const {value,entry}=library.load(file);
    return tool.create(value,{source:{id:entry.id,asset:entry.asset},detect:settings ? read(settings) : {}});
  }
  const edit=tool.validate(read(file)), {id,asset}=edit.source, found=library.get(id);
  if (found.entry.asset!==asset) throw new RangeError('Sample edit source hash does not match the library');
  if (mode==='edit') {
    if (!settings) throw new TypeError('Pass a JSON list of sample edits');
    return tool.edit(edit,read(settings));
  }
  if (typeof out!=='string') throw new TypeError('Use --out with an audio output directory');
  const options=settings ? read(settings) : {};
  const result=tool[mode](library.load(id).value,edit,options);
  const folder=path.resolve(out), audio=path.join(folder,mode==='render' ? 'edit.wav' : 'audition.wav');
  write(audio,WAV.encode(result.value,{encoding:'float64'}));
  let hardCut;
  if (result.hardCut) {
    hardCut=path.join(folder,'hard-cut.wav');
    write(hardCut,WAV.encode(result.hardCut,{encoding:'float64'}));
  }
  const report=path.join(folder,'report.json');
  json(report,{...result.report,audio,...(hardCut && {hardCut})});
  return {audio,report,...(hardCut && {hardCut})};
}

module.exports = function command([mode,directory,file,settings],opt,kit) {
  if (!directory) throw new TypeError('Pass a sample library directory');
  const library = openSampleLibrary(directory,{kit});
  let value;
  if (mode==='add' && file) value = library.add(capture(file,read(file),kit));
  else if (mode==='search') value = library.search(file ? read(file) : undefined);
  else if (mode==='get' && file) value = library.get(file);
  else if (['slice','edit','render','audition'].includes(mode))
    value=editCommand(mode,file,settings,opt.out,library,kit.KIT.procedural.mediaGraph.sampleEdit);
  else throw new TypeError('Use music samples add, search, get, slice, edit, render or audition');
  if (mode==='render' || mode==='audition') {
    process.stdout.write(JSON.stringify(value)+'\n');
    return value;
  }
  if (typeof opt.out==='string') json(path.resolve(opt.out),value);
  else process.stdout.write(JSON.stringify(value,null,2)+'\n');
  return value;
};
