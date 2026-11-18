const test = require('node:test');
const assert = require('node:assert/strict');
const { mesh, authoring: A } = require('..').load().KIT;
const family = (id, fields = {}) => ({
  id, kind: 'prop', version: 1, bounds: {min:[-.1,0,-.1],max:[.1,.3,.1]},
  sockets: {base:{p:[0,0,0],dir:[0,1,0]}}, requiredSockets:['base'],
  variants:[{id:'one',recipe:{type:'example',size:1}}], ...fields
});
const extension = (id, replacements, families = [family(id+'/lamp')]) => ({
  format:'ink-studio/asset-pack',version:1,revision:1,id,title:id,families,replacements
});

test('asset catalogs expose additions and resolve ordered compatible replacements per scene',()=>{
  const base=family('lamp'), first=extension('blue',{lamp:'blue/lamp'}), second=extension('clay',{lamp:'clay/lamp'});
  const catalog=A.assetPacks.create({families:[base],packs:[first,second]});
  assert.equal(catalog.get('blue/lamp').id,'blue/lamp');
  assert.equal(catalog.compile().resolve('lamp').id,'lamp');
  assert.equal(catalog.compile(['blue','clay']).resolve('lamp').id,'clay/lamp');
  assert.equal(catalog.compile(['clay','blue']).resolve('lamp').id,'blue/lamp');
  assert.equal(catalog.compile(['blue']).choose('lamp','slot',3).recipe.size,1);
  assert.deepEqual(catalog.compile(['missing']).missing,['missing']);
  assert.equal(catalog.compile(['missing']).resolve('lamp').id,'lamp');
  assert.throws(()=>A.assetPacks.create({families:[base],packs:[extension('loose',{lamp:'loose/lamp'},[
    family('loose/lamp',{sockets:{},requiredSockets:[]})
  ])]}),/Incompatible/);
  const left=extension('blue',{'clay/lamp':'blue/lamp'}),right=extension('clay',{'blue/lamp':'clay/lamp'});
  const cyclic=A.assetPacks.create({packs:[left,right]});
  assert.throws(()=>cyclic.compile(['blue','clay']),/Cyclic/);
  assert.throws(()=>A.assetPacks.create({packs:[first,first]}),/Duplicate/);
});

function makeGLB() {
  const positions=[-1,0,0,1,0,0,0,1,0];
  const bin=Buffer.alloc(36);
  positions.forEach((v,i)=>bin.writeFloatLE(v,i*4));
  const scene={asset:{version:'2.0'},scenes:[{nodes:[0]}],nodes:[{mesh:0}],
    meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}],
    materials:[{pbrMetallicRoughness:{baseColorFactor:[1,0,0,1]}}],
    buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteLength:bin.length}],
    accessors:[{bufferView:0,componentType:5126,type:'VEC3',count:3}]};
  const raw=Buffer.from(JSON.stringify(scene)), json=Buffer.alloc((raw.length+3)&~3,32);
  raw.copy(json);
  const head=Buffer.alloc(12), jt=Buffer.alloc(8),bt=Buffer.alloc(8);
  head.writeUInt32LE(0x46546c67);head.writeUInt32LE(2,4);head.writeUInt32LE(28+json.length+bin.length,8);
  jt.writeUInt32LE(json.length);jt.writeUInt32LE(0x4e4f534a,4);
  bt.writeUInt32LE(bin.length);bt.writeUInt32LE(0x004e4942,4);
  return Buffer.concat([head,jt,json,bt,bin]);
}

test('GLB imports a fitted mesh and preserves face color in a self-contained recipe',()=>{
  const raw=makeGLB(), recipe = A.assetMeshes.fromGLB(raw,{size:1});
  assert.deepEqual(recipe.triangles,[0,1,2]);
  assert.deepEqual(recipe.colors[recipe.faceColors[0]],[1,0,0]);
  assert.deepEqual(recipe.positions,[-.5,0,0,.5,0,0,0,.5,0]);
  assert.deepEqual(A.assetMeshes.validate(JSON.parse(JSON.stringify(recipe))),recipe);
  assert.throws(()=>A.assetMeshes.fromGLB(raw.subarray(0,-1)),/complete/);
  const invalid = {...recipe,triangles:[0,1,9]};
  assert.throws(()=>A.assetMeshes.validate(invalid),/Invalid triangle/);
  assert.throws(()=>A.assetMeshes.recipe(mesh.make([0,0,0,0,0,0,0,0,0],[0,1,2])),/area/);
});
