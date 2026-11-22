const fs=require('node:fs'),path=require('node:path');
const WAV=require('./wav.js'),{write,json}=require('./asset-files.js');

module.exports=function repairCommand([file,settings],opt,kit) {
  if (!file || !settings || typeof opt.out!=='string')
    throw new TypeError('Use music repair input.wav settings.json --out directory');
  const A=kit.KIT.procedural.mediaGraph;
  const result=A.repairDialogue(WAV.read(file),JSON.parse(fs.readFileSync(settings,'utf8')));
  const directory=path.resolve(opt.out), report=path.join(directory,'report.json');
  const emit=(name,audio)=>{
    const file=path.join(directory,name+'.wav');
    write(file,WAV.encode(audio,{encoding:'pcm24'}));
    return file;
  };
  const files={before:emit('before',result.before),repaired:emit('repaired',result.value),
    removed:emit('removed',result.removed),report};
  json(report,result.report);
  process.stdout.write(JSON.stringify(files)+'\n');
  return files;
};
