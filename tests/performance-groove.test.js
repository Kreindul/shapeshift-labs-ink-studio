const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('..'), {KIT:K}=ink.load(), P=K.procedural,A=K.music.production;
const MIDI=require('../cli/midi-notes');
const rate=8000, settings={id:'test-break',step:.25,length:4};
const note=(lane,beat,velocity,durationBeats)=>({lane,beat,velocity,durationBeats});
const near=(value,expected,tol=1e-8)=>assert(Math.abs(value-expected)<tol,value+' vs '+expected);

function midiFile() {
  const header=Buffer.from('4d546864000000060001000201e0','hex');
  const track=bytes=>{
    const head=Buffer.from('MTrk0000');
    head.writeUInt32BE(bytes.length,4);
    return Buffer.concat([head,Buffer.from(bytes)]);
  };
  return Buffer.concat([header,track([0,255,81,3,7,161,32,0,255,47,0]),
    track([19,153,36,110,80,36,0,127,38,57,96,38,0,0,255,47,0])]);
}

function makeSource() {
  const n=(beat,velocity=.72,play)=>({beat,duration:.2,velocity,...(play && {play})});
  const motif=(...events)=>({length:4,events});
  return {seed:15,arrangement:{
    score:{tempoMap:{tempo:80},key:{root:'F3',mode:'minor'},harmonies:{home:{root:'F3',quality:'minor'}}},
    motifs:{low:motif(n(0),n(1),n(2),n(2.5)),kick:motif(n(0),n(1),n(2)),
      snare:motif(n(1,.69),n(1.75,.39,{articulation:'ghost'}),n(3,.88))},
    parts:{bass:{role:'bass',material:'low'},kick:{role:'percussion',material:'kick',voice:{instrument:'kick'}},
      snare:{role:'percussion',material:'snare',voice:{instrument:'snare'}}},
    sections:[{id:'loop',bars:2,harmony:'home'}]
  },patches:{bass:{type:'analog'},kick:{type:'drum',kind:'kick'},snare:{type:'drum',kind:'snare'}},
    tracks:{bass:{patch:'bass',gain:-15,groove:{offset:.013}},kick:{patch:'kick',gain:-11},snare:{patch:'snare',gain:-12}}};
}
function mapping() {
  const {value:template}=P.performanceGroove.fit([
    note('kick',.04,.9,.10),note('kick',.94,.5,.16),note('kick',2.08,.8,.13),
    note('snare',1.06,.62,.12),note('snare',3.09,.86,.18),note('ghost',1.69,.29,.06)
  ],settings);
  return {template,anchors:[0,4],links:[{leader:'kick',followers:['bass']}],
    tracks:{kick:{lane:'kick',timing:1,accent:0,length:0},snare:{lane:'snare',timing:1,accent:.55,length:.4,
      articulations:{ghost:{lane:'ghost',timing:.7,accent:0,length:1}}}}};
}

test('MIDI PPQ notes preserve note lengths, running status and channel identity',()=>{
  const {format,ppq,tracks,notes}=MIDI.decode(midiFile());
  assert.deepEqual({format,ppq,tracks},{format:1,ppq:480,tracks:2});
  assert.deepEqual(notes,[
    {track:1,channel:10,pitch:36,beat:19/480,velocity:110/127,durationBeats:80/480},
    {track:1,channel:10,pitch:38,beat:226/480,velocity:57/127,durationBeats:96/480}
  ]);
  assert.throws(()=>MIDI.decode(midiFile().subarray(0,-1)),/extends past/);
});

test('fitting measures offsets against the source grid and folds repeated passes via medians',()=>{
  const {value,report}=P.performanceGroove.fit([
    note('rim',1.06,.9,.19),note('rim',5.04,.7,.17),note('rim',3.08,.52,.29),note('rim',7.10,.38,.31),
    note('rim',5.125,.9,.1),note('rim',8.01,.7,.1)
  ],{...settings,cycles:2});
  assert.equal(report.outside,1);
  assert.equal(report.unmatched,1);
  assert.deepEqual(value.lanes.rim,[
    {slot:4,offset:.05,accent:1.31147541,length:.18},
    {slot:12,offset:.09,accent:.737704918,length:.3}
  ]);
});

test('audio extraction measures attacks, relative accents and envelope lengths on each WAV lane',()=>{
  const wave=hits=>{
    const samples=new Float64Array(rate*2);
    for (const [time,level,span] of hits) {
      const first=Math.round(time*rate), n=Math.round(span*rate);
      for (let k=0;k<n;k++) samples[first+k]=level*Math.cos(k*1.12)*Math.exp(-k/n);
    }
    return {sampleRate:rate,channels:1,samples};
  };
  const {value,report}=P.mediaGraph.extractGroove({
    kick:wave([[.041,.74,.082],[.48,.51,.141]]),foley:wave([[.753,.48,.044],[1.485,.64,.076]])
  },{grid:settings,detect:{size:128,hop:24,minGap:.065,minStrength:.012,sensitivity:1}});
  assert.deepEqual(Object.keys(value.lanes),['kick','foley']);
  const [first,second]=value.lanes.kick;
  assert.deepEqual([first.slot,second.slot],[0,4]);
  near(first.offset,.082,.01);
  near(second.offset,-.04,.01);
  assert(first.accent>second.accent && second.length>first.length+.09);
  assert.equal(report.source,'audio');
});

test('groove transfer is tempo-relative, leaves unmatched notes alone and links bass to the actual kick',()=>{
  const input=makeSource(), map=mapping(), baseline=A.inspect(input).events;
  const result=A.mapGroove(input,map), {events}=A.inspect(result.production);
  const at=(name,beat)=>events[name].find(row=>row.beat===beat);
  near(at('kick',2).time,1.56);
  near(at('kick',1).time,.705);
  near(at('bass',2).time,at('kick',2).time);
  near(at('bass',2.5).time,baseline.bass.find(row=>row.beat===2.5).time);
  near(at('bass',0).time,0);
  near(at('snare',1.75).time,(1.75-.06*.7)*.75);
  near(at('snare',1.75).gate,.06*.75);
  assert.equal(result.report.tracks.kick.resized,0);
  assert(result.report.tracks.snare.accented>0);
  assert(result.report.tracks.bass.moved>0);
  const straight={template:map.template,tracks:Object.fromEntries(Object.keys(map.tracks).map(name=>
    [name,{lane:map.tracks[name].lane,timing:0,accent:0,length:0}]))};
  assert.deepEqual(A.inspect(A.mapGroove(input,straight).production).events,baseline);
  const routed=mapping();
  routed.roles={bass:{lane:'kick',timing:.4,accent:0,length:0}};
  const onlyLanes=A.mapGroove(input,{...routed,links:[]}).production;
  near(A.inspect(onlyLanes).events.bass.find(row=>row.beat===2).time,1.537);
  input.arrangement.pins=['part:bass'];
  assert.throws(()=>A.mapGroove(input,map),/pinned part bass/);
  input.arrangement.pins=[];
  input.cueMap={silence:[{from:1.9,to:2.2,parts:['kick']}]};
  const muted=A.inspect(A.mapGroove(input,map).production).events;
  assert(!muted.kick.some(row=>row.beat===2));
  near(muted.bass.find(row=>row.beat===2).time,1.513);
});

test('CLI extracts a MIDI take by role and applies it as an ordinary production recipe',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-groove-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const save=(file,value)=>fs.writeFileSync(path.join(root,file),JSON.stringify(value));
  fs.writeFileSync(path.join(root,'take.mid'),midiFile());
  save('recipe.json',{input:{kind:'midi',file:'take.mid',lanes:[
    {lane:'low',track:1,channel:10,notes:[36]},{lane:'rim',notes:[38]}
  ]},grid:settings});
  const cli=(...args)=>execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'music',...args],
    {cwd:root,encoding:'utf8'});
  cli('groove','extract','recipe.json','--out','groove.json');
  const fit=JSON.parse(fs.readFileSync(path.join(root,'groove.json')));
  assert.equal(fit.report.midi.ppq,480);
  near(fit.template.lanes.low[0].length,1/6);
  save('source.json',makeSource());
  save('map.json',{template:'groove.json',tracks:{kick:{lane:'low',timing:1,length:1}}});
  cli('production','groove','source.json','map.json','--out','target.json');
  const inspect=JSON.parse(cli('production','inspect','target.json'));
  near(inspect.events.kick[0].time,19/480*.75);
  near(inspect.events.kick[0].gate,.125);
});
