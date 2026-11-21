const fs=require('node:fs'), path=require('node:path');
const WAV=require('./wav.js'), {write,json}=require('./asset-files.js');

function measure(mode,file,opt,monitor) {
  const input=WAV.read(file);
  const number=name=>{
    if (opt[name]===undefined) return undefined;
    if (typeof opt[name]!=='string' || !opt[name].trim()) throw new TypeError('Expected a number for --'+name);
    return Number(opt[name]);
  };
  if (mode==='meter') {
    const result=monitor.meter(input,{firstSample:number('from-sample'),endSample:number('to-sample')});
    if (typeof opt.out==='string') json(opt.out,result);
    process.stdout.write(JSON.stringify(result)+'\n');
    return result;
  }
  if (typeof opt.out!=='string' || opt.focus!==undefined && typeof opt.focus!=='string')
    throw new TypeError('Use music mix monitor input.wav [--mode mono|small-speaker|stereo] [--focus stem.wav] --out directory');
  const {value,report}=monitor.preview(input,{mode:opt.mode,lowHz:number('low-hz'),highHz:number('high-hz')},
    opt.focus && WAV.read(opt.focus));
  const directory=path.resolve(opt.out), preview=path.join(directory,'preview.wav'), fileReport=path.join(directory,'report.json');
  write(preview,WAV.encode(value,{encoding:'pcm24'}));
  json(fileReport,report);
  const result={preview,report:fileReport};
  process.stdout.write(JSON.stringify(result)+'\n');
  return result;
}

module.exports=function mixCommand([mode,file],opt,kit) {
  const P=kit.KIT.procedural;
  if (file && (mode==='meter' || mode==='monitor')) return measure(mode,file,opt,P.mediaGraph.mixerMonitor);
  if (mode!=='render' || !file || typeof opt.out!=='string')
    throw new TypeError('Use music mix render, meter or monitor with a recipe or WAV');
  const {fields,record,id,check}=P.musicInstruments;
  const recipe=JSON.parse(fs.readFileSync(file,'utf8'));
  check(fields(recipe,['mixer','assets']) && record(recipe.assets) && Object.keys(recipe.assets).length<=128,
    'Expected a mixer and a table of WAV assets');
  const folder=path.dirname(path.resolve(file)), cache=new Map();
  let samples=0;
  const assets=Object.fromEntries(Object.entries(recipe.assets).map(([name,relative])=>{
    check(id(name) && typeof relative==='string' && relative.trim(),'Invalid mixer WAV asset');
    const file=path.resolve(folder,relative);
    if (!cache.has(file)) {
      const pcm=WAV.read(file);
      samples+=pcm.samples.length;
      check(samples<=32e6,'Mixer WAV assets exceed their PCM budget');
      cache.set(file,pcm);
    }
    return [name,cache.get(file)];
  }));
  const result=P.mediaGraph.mixer.render(recipe.mixer,assets), target=path.resolve(opt.out);
  const mix=path.join(target,'mix.wav'), report=path.join(target,'report.json');
  const taps=Object.fromEntries(Object.entries(result.taps).map(([name,pcm])=>{
    const file=path.join(target,'taps',name+'.wav');
    write(file,WAV.encode(pcm,{encoding:'pcm24'}));
    return [name,file];
  }));
  write(mix,WAV.encode(result.value,{encoding:'pcm24'}));
  json(report,result.report);
  const manifest={mix,report,taps};
  process.stdout.write(JSON.stringify(manifest)+'\n');
  return manifest;
};
