const fs=require('node:fs'),path=require('node:path'),WAV=require('./wav.js');
const {json,write}=require('./asset-files.js');
const {openSampleLibrary}=require('./sample-library.js');
const {resolveSampleAssets}=require('./music-sample-assets.js');

module.exports=function instrumentCommand([mode,file],opt,kit) {
  if (!file || !['analyze','audition','build'].includes(mode) || (mode!=='analyze' && typeof opt.out!=='string'))
    throw new TypeError('Use music instrument analyze, audition, or build with a recipe and --out');
  const P=kit.KIT.procedural,{fields,check,record}=P.musicInstruments, A=P.mediaGraph.sampleInstrument;
  const recipe=JSON.parse(fs.readFileSync(file,'utf8'));
  check(fields(recipe,['assets','library','analysis','audition','zones','env']) && record(recipe.assets) &&
    Object.keys(recipe.assets).length<=24 && (recipe.library===undefined || typeof recipe.library==='string'),
  'Instrument recipes need named WAVs, samples, edits, or prints');
  const library=recipe.library===undefined ? undefined : openSampleLibrary(path.resolve(path.dirname(file),recipe.library),{kit});
  const {assets,sources}=resolveSampleAssets(recipe.assets,file,library,kit,{allowWav:true});
  const send=result=>{process.stdout.write(JSON.stringify(result)+'\n');return result;};
  if (mode==='analyze') {
    const result={...A.analyze(assets,recipe.analysis),sources};
    if (typeof opt.out==='string') json(path.resolve(opt.out),result);
    return send(result);
  }
  const dir=path.resolve(opt.out), report=path.join(dir,'report.json');
  if (mode==='audition') {
    check(record(recipe.audition ?? {}),'Invalid range audition settings');
    const result=A.audition(assets,{analysis:recipe.analysis,...recipe.audition});
    const audio=path.join(dir,'range.wav');
    write(audio,WAV.encode(result.value,{encoding:'pcm24'}));
    json(report,{...result.report,sources});
    return send({audio,report});
  }
  const result=A.build(assets,{analysis:recipe.analysis,zones:recipe.zones,env:recipe.env});
  const baked=Object.fromEntries(Object.entries(result.assets).map(([name,value])=>{
    const file='samples/'+name+'.wav';
    write(path.join(dir,file),WAV.encode(value,{encoding:'float32'}));
    return [name,file];
  }));
  const instrument=path.join(dir,'instrument.json');
  json(instrument,{patch:result.value,assets:baked,zones:result.report.zones});
  json(report,{...result.report,sources});
  return send({instrument,report});
};
