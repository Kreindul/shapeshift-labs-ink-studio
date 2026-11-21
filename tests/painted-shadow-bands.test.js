const test = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const { KIT: K, makeBuilder, makeSculpt } = ink.load();
const paint = K.surface.shadowBandPaint;
const palette = [0x151921,0x503445,0xa26146,0xf3c97a];
const ramp = { stops:[[0,1],[.5,2],[.82,3]], interpolation:'step' };
const mark = (points, radius, bias, softness=0) => ({points,radius,bias,softness});

test('signed brush paths feather and erase in paint order without changing the source', () => {
  const dabs = [
    mark([[-1,0,0],[1,0,0]],.5,.6,.4),
    mark([[0,0,0]],.13,0),
    mark([[1,0,0]],.1,-.2)
  ];
  const read = paint.prepare(dabs);
  assert.equal(read([0,0,0]),0);
  assert.equal(read([1,0,0]),-.2);
  assert.equal(read([.7,.1,0]),.6);
  assert.ok(Math.abs(read([.7,.4,0])-.3)<1e-9);
  assert.equal(read([.7,0,.6]),0);
  dabs[0].points[0][0]=8;
  assert.equal(read([-.8,0,0]),.6);
  assert.throws(()=>paint.prepare([mark([[0,0,0]],.1,2)]),/bias in/);
});

test('paint moves the exact ramp transition in both directions and preserves full light occlusion', () => {
  const settings = { layers:{diffuse:{type:'diffuse',lightingRamp:ramp,shadowBand:{strokes:[
    mark([[-1,0,0]],.5,.23),mark([[1,0,0]],.5,-.31)
  ]}}} };
  const prepared=K.surface.prepare(settings,palette), bypass=K.surface.prepare(settings,palette,undefined,{}, {paintShadowBands:false});
  function rgb(x,z,visibility=1,look=prepared) {
    const lightDirection=[Math.sqrt(1-z*z),0,z];
    return K.surface.shade(look,{position:[x,0,0],worldPosition:[7,2,3],normal:[0,0,1],view:[0,0,1],
      visibility,lightDirection},[0,0,0]).slice(0,3).map(n=>Math.round(n*255));
  }
  assert.deepEqual(rgb(-1,.65),[80,52,69]);
  assert.deepEqual(rgb(0,.65),[162,97,70]);
  assert.deepEqual(rgb(1,.65),[243,201,122]);
  assert.deepEqual(rgb(1,.65,0),[80,52,69]);
  assert.deepEqual(rgb(1,.65,1,bypass),rgb(0,.65));
  assert.throws(()=>K.surface.prepare({layers:{gloss:{type:'specular',shadowBand:settings.layers.diffuse.shadowBand}}},palette),/diffuse/);
});

test('headless draws a brush boundary inside one material and can bypass the paint', () => {
  const B=makeBuilder(19,palette), S=K.sculpt(makeSculpt(B));
  Object.assign(S,{sun:[.8,0,.6],amb:.6,sky:0,sunK:.25,shLen:0});
  const slate=K.surface.material({r:[1,2,3]},{layers:{diffuse:{type:'diffuse',lightingRamp:ramp,shadow:false,
    shadowBand:{strokes:[mark([[-.6,-.42,.10],[-.6,.42,.10]],.32,.35)]}}}});
  S.box([0,0,0],[1,.67,.10],slate,{res:.13,rd:.012});
  S.bake();
  const world=B.finish({cam:{target:[0,0,0],yaw:0,pitch:0,dist:3,fov:.65,ortho:true},radius:4,
    fog:{start:1,max:0,c:0},look:{splatCoverage:'continuous'}});
  const opts={ w:96,h:64,px:1,raw:true }, on=ink.render(world,opts), off=ink.render(world,{...opts,shadowBandPaint:false});
  const pixel=(frame,x)=>Array.from(frame.rgb.subarray((32*96+x)*3,(32*96+x)*3+3));
  assert.deepEqual(pixel(on,29),[80,52,69]);
  assert.deepEqual(pixel(off,29),[162,97,70]);
  assert.deepEqual(pixel(on,62),pixel(off,62));
});

test('the scene editor retains and undoes a shadow brush stroke on the chosen diffuse layer', () => {
  const source={id:'band-test',solids:[
    {id:'tile',kind:'box',at:[0,0,0],half:[1,1,.2],mat:{role:'stone',
      surface:{layers:{diffuse:{type:'diffuse',lightingRamp:{stops:[[0,'#503445'],[.5,'#a26146']]}}}}}},
    {id:'unlit',kind:'ball',at:[2,0,0],r:.4,mat:'stone'}
  ]};
  const editor=ink.createSceneEditor(source), stroke=mark([[0,0,.1]],.3,.25);
  const layer=()=>editor.snapshot().solids[0].mat.surface.layers.diffuse;
  editor.select(['solid:tile']);
  assert.equal(editor.paintShadowBand(stroke),true);
  assert.deepEqual(layer().shadowBand.strokes,[stroke]);
  assert.deepEqual(JSON.parse(editor.serialize()).solids[0].mat.surface.layers.diffuse.shadowBand.strokes,[stroke]);
  assert.throws(()=>editor.paintShadowBand(stroke,{keys:['solid:tile','solid:unlit']}),/diffuse lighting ramp/);
  assert.equal(layer().shadowBand.strokes.length,1);
  editor.undo();
  assert.equal(layer().shadowBand,undefined);
  editor.redo();
  assert.equal(layer().shadowBand.strokes.length,1);
});
