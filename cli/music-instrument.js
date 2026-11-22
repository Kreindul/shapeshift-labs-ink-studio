const fs=require('node:fs'),path=require('node:path'),WAV=require('./wav.js');
const {json,write}=require('./asset-files.js');
const {openSampleLibrary}=require('./sample-library.js');
const {resolveSampleAssets}=require('./music-sample-assets.js');

module.exports=function instrumentCommand([mode,file],opt,kit) {
  if (!file || !['analyze','audition','build','fit','audition-fit'].includes(mode) || (mode!=='analyze' && typeof opt.out!=='string'))
    throw new TypeError('Use music instrument analyze, audition, build, fit, or audition-fit with a recipe and --out');
  const P=kit.KIT.procedural,{fields,check,record}=P.musicInstruments, A=P.mediaGraph.sampleInstrument;
  const recipe=JSON.parse(fs.readFileSync(file,'utf8'));
  const send=result=>{process.stdout.write(JSON.stringify(result)+'\n');return result;};
  if (mode==='audition-fit') {
    check(fields(recipe,['fit','assets','reference','audition']) && record(recipe.assets) &&
      Object.keys(recipe.assets).length<=24 &&
      (recipe.reference===undefined || typeof recipe.reference==='string'),'Expected an editable instrument fit manifest');
    const {assets}=resolveSampleAssets(recipe.assets,file,undefined,kit,{allowWav:true});
    const source=recipe.reference===undefined ? undefined : WAV.read(path.resolve(path.dirname(file),recipe.reference));
    const result=P.mediaGraph.instrumentFit.audition(recipe.fit,assets,recipe.audition,source);
    const audio=path.resolve(opt.out,'fit-audition.wav'), report=path.resolve(opt.out,'report.json');
    write(audio,WAV.encode(result.value,{encoding:'pcm24'}));
    json(report,result.report);
    return send({audio,report});
  }
  check(fields(recipe,mode==='fit' ? ['assets','library','options'] : ['assets','library','analysis','audition','zones','env']) &&
    record(recipe.assets) &&
    Object.keys(recipe.assets).length<=24 && (recipe.library===undefined || typeof recipe.library==='string'),
  'Instrument recipes need named WAVs, samples, edits, or prints');
  const library=recipe.library===undefined ? undefined : openSampleLibrary(path.resolve(path.dirname(file),recipe.library),{kit});
  const {assets,sources}=resolveSampleAssets(recipe.assets,file,library,kit,{allowWav:true});
  if (mode==='fit') {
    const names=Object.keys(assets);
    check(names.length===1,'Fit one selected recording, sample or slice per recipe');
    const name=names[0], result=P.mediaGraph.instrumentFit.fit(assets[name],recipe.options);
    const dir=path.resolve(opt.out), instrument=path.join(dir,'instrument-fit.json'), report=path.join(dir,'report.json');
    const baked=writeAssets(dir,result.assets);
    write(path.join(dir,'reference.wav'),WAV.encode(result.reference,{encoding:'float32'}));
    json(instrument,{fit:result.value,assets:baked,reference:'reference.wav'});
    json(report,{...result.report,source:sources[name]});
    return send({instrument,report});
  }
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
  const baked=writeAssets(dir,result.assets);
  const instrument=path.join(dir,'instrument.json');
  json(instrument,{patch:result.value,assets:baked,zones:result.report.zones});
  json(report,{...result.report,sources});
  return send({instrument,report});
};

function writeAssets(dir,assets) {
  return Object.fromEntries(Object.entries(assets).map(([name,value])=>{
    const file='samples/'+name+'.wav';
    write(path.join(dir,file),WAV.encode(value,{encoding:'float32'}));
    return [name,file];
  }));
}
