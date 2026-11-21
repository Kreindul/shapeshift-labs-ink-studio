const fs=require('node:fs');
const {json}=require('./asset-files.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));

module.exports=function padCommand([mode,file,settings],opt,kit) {
  if (!file || !['program','capture','edit'].includes(mode) || (mode!=='program' && !settings))
    throw new TypeError('Use music pads program, capture, or edit with a source and applicable settings file');
  const {padPattern}=kit.KIT.procedural.mediaGraph;
  const source=read(file), rules=settings ? read(settings) : undefined;
  let value;
  if (mode==='program') value=padPattern.perform(source,rules).value;
  else if (mode==='capture') {
    const {routes,options}=rules;
    value=padPattern.capture(source,routes,options);
  } else value=padPattern.edit(source,rules);
  if (typeof opt.out==='string') json(opt.out,value);
  else process.stdout.write(JSON.stringify(value,null,2)+'\n');
  return value;
};
