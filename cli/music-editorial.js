const fs=require('node:fs'),path=require('node:path');
const WAV=require('./wav.js'),{write,json}=require('./asset-files.js'),{readAssets}=require('./music-mixer.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const print=value=>{process.stdout.write(JSON.stringify(value,null,2)+'\n');return value;};
function portable(assets,input,output) {
  const from=path.dirname(path.resolve(input)), to=path.dirname(path.resolve(output));
  return Object.fromEntries(Object.entries(assets).map(([name,wav])=>[name,path.relative(to,path.resolve(from,wav))]));
}
module.exports=function editorialCommand([mode,file,changes],opt,kit) {
  if (!file || !['inspect','edit','render','reconform'].includes(mode))
    throw new TypeError('Use music editorial inspect, edit, render or reconform');
  const P=kit.KIT.procedural,A=P.mediaGraph.audioEditorial,{fields,check}=P.musicInstruments;
  const recipe=read(file);
  check(fields(recipe,['session','assets']),'Expected an editorial session and a WAV asset table');
  const assets=readAssets(recipe.assets,file,P), {session}=recipe;
  const emit=(audio,target)=>{write(target,WAV.encode(audio,{encoding:'pcm24'}));return target;};
  if (mode==='inspect') {
    const report=A.inspect(session,assets);
    if (typeof opt.out==='string') json(opt.out,report);
    return print(report);
  }
  if (typeof opt.out!=='string' || (mode==='edit' || mode==='reconform') && !changes)
    throw new TypeError('Provide --out and the changes file for edit or reconform');
  if (mode==='edit') {
    const {value,report}=A.revise(session,assets,read(changes)), target=path.resolve(opt.out);
    json(target,{session:value,assets:portable(recipe.assets,file,target)});
    return print({project:target,report});
  }
  const dir=path.resolve(opt.out), report=path.join(dir,'report.json');
  if (mode==='reconform') {
    const result=A.reconform(session,assets,read(changes)), project=path.join(dir,'project.json');
    const before=emit(result.before,path.join(dir,'before.wav')), after=emit(result.value,path.join(dir,'after.wav'));
    json(report,result.report);
    json(project,{session:result.session,assets:portable(recipe.assets,file,project)});
    return print({before,after,report,project});
  }
  const result=A.render(session,assets,{stems:opt.stems===true,allowUnresolved:opt['allow-unresolved']===true});
  const mix=emit(result.value,path.join(dir,'mix.wav'));
  const stems=Object.fromEntries(Object.entries(result.stems).map(([name,audio])=>
    [name,emit(audio,path.join(dir,'stems',name+'.wav'))]));
  json(report,result.report);
  return print({mix,report,stems});
};
