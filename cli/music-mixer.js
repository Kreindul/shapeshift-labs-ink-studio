const fs=require('node:fs'), path=require('node:path');
const WAV=require('./wav.js'), {write,json}=require('./asset-files.js');

module.exports=function mixCommand([mode,file],opt,kit) {
  if (mode!=='render' || !file || typeof opt.out!=='string')
    throw new TypeError('Use music mix render recipe.json --out directory');
  const P=kit.KIT.procedural,{fields,record,id,check}=P.musicInstruments;
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
