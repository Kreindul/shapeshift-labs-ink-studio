const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {execFileSync}=require('node:child_process'), ink=require('..'), WAV=require('../cli/wav.js');
const M=ink.load().KIT.procedural.mediaGraph, rate=8000;
const s=samples=>({samples}), b=beat=>({beat});
const format='ink-studio/music-edit-session';
const voice=(id,beat,midi,velocity=.55)=>({id,beat,duration:.32,midi,velocity});
const notes=[voice('call',.5,60),voice('answer',2.5,64)];
const clips=notes=>[{id:'line',beat:0,length:4,voices:[{id:'solo',notes}]}];
const session=()=>({format,version:1,id:'bench',sampleRate:rate,production:{
  arrangement:{score:{key:{root:'C4'},tempoMap:{tempo:120},endFade:0,harmonies:{c:{root:'C3',quality:'unison'}}},
    motifs:{pulse:{length:4,events:[{id:'tap',beat:0,duration:.2,degree:1}]}},
    parts:{lead:{role:'lead',material:'pulse'},kick:{role:'percussion',material:'pulse'}},
    sections:[{id:'cue',bars:1,harmony:'c'}]},
  patches:{keys:{type:'subtractive'},drum:{type:'drum',kind:'kick'}},
  tracks:{lead:{patch:'keys',gain:-14,clips:clips(notes)},kick:{patch:'drum',gain:-16}}
},takes:{soft:{tracks:{lead:{clips:clips([{...notes[0],velocity:.34},{...notes[1],beat:2.7,velocity:.31}])}}},
  wrong:{tracks:{lead:{clips:clips([notes[0],{...notes[1],midi:67}])}}}},
  pins:{lead:'pitch',kick:'all'},mixer:{output:'master',strips:{master:{},lead:{},kick:{}},
    taps:{lead:{strip:'lead'},kick:{strip:'kick'}}}});
const pcm=(frames,fn)=>({sampleRate:rate,channels:1,samples:Float64Array.from({length:frames},(_,i)=>fn(i))});

test('a score comp keeps stable addresses, locks pitches and reuses unedited tracks',()=>{
  const E=M.musicSession.create(), source=session(), original=E.render(source);
  assert.deepEqual(original.report.cache,{hits:0,misses:2});
  const {lead}=E.inspect(source).lanes;
  assert.deepEqual(lead.takes.reference[1].address,['lead','line','solo','answer',0]);
  assert.deepEqual(lead.takes.reference[1].address,lead.takes.soft[1].address);
  const edit={op:'comp',lane:'lead',take:'soft',from:b(2),to:b(4)};
  const comp=E.edit(source,[edit]), rendered=E.render(comp);
  assert.deepEqual(rendered.report.cache,{hits:2,misses:1});
  assert.deepEqual(rendered.taps.kick.samples,original.taps.kick.samples);
  assert.deepEqual(rendered.value.samples.slice(0,16000),original.value.samples.slice(0,16000));
  assert.notDeepEqual(rendered.value.samples.slice(16000),original.value.samples.slice(16000));
  assert.equal(E.inspect(source).comp.length,0);
  assert.throws(()=>E.edit(comp,[{...edit,take:'wrong'}]),/pinned pitches/);
  assert.throws(()=>E.edit(comp,[{...edit,lane:'kick'}]),/Lane is pinned/);
  const key={op:'note',take:'soft',lane:'lead',clip:'line',voice:'solo',note:'answer'};
  assert.throws(()=>E.edit(comp,[{...key,set:{midi:61}}]),/pinned pitches/);
  const moved=E.edit(comp,[{...key,set:{beat:2.9,velocity:.4}}]);
  assert.deepEqual(E.render(moved).report.cache,{hits:2,misses:1});
  assert.equal(E.inspect(moved).lanes.lead.takes.soft[1].beat,2.9);
  assert.deepEqual(E.inspect(E.edit(comp,[{...edit,take:'reference',from:b(2.9),to:b(3.2)}])).comp
    .map(({from,to,take})=>[from,to,take]),[[8000,11600,'soft'],[11600,12800,'reference'],[12800,16000,'soft']]);
});

test('audition switches in score time with warm delay that survives a loop wrap',()=>{
  const E=M.musicSession.create({hit:pcm(16000,i=>i===7600 ? .72 : 0),silence:pcm(16000,()=>0)});
  const source=session();
  source.audio={cue:{take:'live',takes:{live:{asset:'hit'},muted:{asset:'silence'}}}};
  source.mixer.strips.cue={sends:{echo:{level:1}}};
  source.mixer.strips.echo={inserts:['delay']};
  source.mixer.processors={delay:{type:'tempo-delay',beats:.25,feedback:.42,wet:1}};
  source.mixer.taps={cue:{strip:'cue'},echo:{strip:'echo'}};
  source.automation={motion:{target:{strip:'cue',parameter:'fader'},unit:'samples',curve:'hold',
    points:[{id:'quiet',at:0,value:.5},{id:'louder',at:7000,value:1}]}};
  const result=E.render(source,{from:s(2000),to:s(8000),passes:2,
    switches:[{pass:0,at:s(7700),lane:'cue',take:'muted'}]});
  assert.equal(result.report.warmupSamples,2000);
  assert.equal(result.report.switches[0].at,5700);
  assert.deepEqual(result.report.segments,[{from:2000,to:8000},{from:2000,to:8000}]);
  assert.equal(result.taps.cue.samples[5600*2],Math.fround(.72));
  assert.equal(result.taps.cue.samples[11600*2],0);
  assert(Math.abs(result.taps.echo.samples[6600*2]-.72)<1e-6);
  assert(Math.abs(result.taps.echo.samples[7600*2])>.02);
  const quieter=E.edit(source,[{op:'automation',lane:'motion',point:'louder',value:.25}]);
  const edited=E.render(quieter,{from:s(2000),to:s(8000)});
  assert.equal(edited.report.cache.misses,0);
  assert.equal(edited.taps.cue.samples[5600*2],Math.fround(.72)*.25);
  const repeated=E.render(source,{from:s(2000),to:s(8000),passes:2});
  assert.equal(repeated.taps.cue.samples[11600*2],Math.fround(.72));
});

test('audio lanes replay editorial comps and native sample-motif plans',()=>{
  const tone=pcm(400,i=>.4*Math.sin(i*Math.PI/9)), alternate=pcm(400,i=>-.4*Math.sin(i*Math.PI/9));
  const backing=pcm(16000,()=>0), plan=M.sampleMotif.plan(tone,backing,{map:{tempo:120},range:{from:b(1),to:b(3)},raw:{at:0}});
  const E=M.musicSession.create({tone,alternate,backing}), source=session();
  const editor={format:'ink-studio/audio-editorial',version:1,id:'spot',sampleRate:rate,
    picture:{fps:20,shots:[{id:'shot',frames:40}]},clips:[{id:'call',track:'mic',spot:s(4000),take:'live',
      takes:{live:{asset:'tone',sync:{sample:0}},alt:{asset:'alternate',sync:{sample:0}}}}]};
  source.audio={sample:{take:'edit',takes:{edit:{editorial:editor,track:'mic'},motif:{motif:{source:'tone',score:'backing',plan,role:'raw'}}}}};
  source.mixer.taps={sample:{strip:'sample'}};
  const altered=E.edit(source,[{op:'editorial',lane:'sample',take:'edit',edits:[
    {op:'comp',clip:'call',ranges:[{take:'alt',fromOffset:100,toOffset:250,fadeSamples:8}]}
  ]}]);
  assert.equal(E.inspect(altered).lanes.sample.takes.edit.editorial.clips[0].id,'call');
  assert.equal(E.render(altered).taps.sample.samples[4150*2],-E.render(source).taps.sample.samples[4150*2]);
  const kept=E.edit(altered,[{op:'comp',lane:'sample',take:'motif',from:b(1),to:b(2)}]);
  const stem=M.sampleMotif.render(plan,tone,backing,'raw').stem.samples;
  assert.equal(E.render(kept).taps.sample.samples[4150*2],Math.fround(stem[300]));
});

test('JSON-line session keeps the cache warm and saves a portable edit',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-edit-session-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'session.json'),JSON.stringify({session:session()}));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const commands=[
    {op:'preview',preview:{from:b(0),to:b(4)},out:'before'},
    {op:'edit',changes:[{op:'comp',lane:'lead',take:'wrong',from:b(2),to:b(4)}]},
    {op:'edit',changes:[{op:'comp',lane:'lead',take:'soft',from:b(2),to:b(4)}],out:'kept/session.json'},
    {op:'render',out:'after'}
  ].map(row=>JSON.stringify(row)).join('\n');
  const response=execFileSync(process.execPath,[cli,'music','session','stream','session.json'],
    {cwd:root,input:commands,encoding:'utf8'}).trim().split('\n').map(JSON.parse);
  assert.deepEqual(response.map(row=>row.ok),[true,false,true,true]);
  assert.deepEqual(response[3].result.cache,{hits:2,misses:1});
  execFileSync(process.execPath,[cli,'music','session','render','kept/session.json','--out','replay'],{cwd:root});
  assert.deepEqual(WAV.read(path.join(root,'after/mix.wav')).samples,WAV.read(path.join(root,'replay/mix.wav')).samples);
});
