const test=require('node:test'),assert=require('node:assert/strict');
const K=require('..').load().KIT,{cantileverSupports:C}=K.procedural;

test('bearing sites use the actual convex footprint, width and seat',()=>{
  const path=[[-3,2,0],[3,2,0]],outline=[[-1.9,-1],[1.9,-1],[1.3,.8],[-1.3,.8]];
  const sites=C.sites({path,outline,outward:-1,spacing:.7});
  assert(sites.length>=3&&sites.length<6);
  assert(sites.some(s=>Math.abs(s.reach-.8)<1e-8));
  assert(sites.every(s=>s.point[1]===2&&s.out[2]===1));
  const reversed=C.sites({path,outline:outline.slice().reverse(),outward:-1,spacing:.7});
  assert.deepEqual(reversed.map(s=>s.index),sites.map(s=>s.index));
  reversed.forEach((s,i)=>assert(Math.abs(s.reach-sites[i].reach)<1e-8));
  const floating=[[0,.03],[2,.03],[2,1],[0,1]];
  assert.deepEqual(C.sites({path,outline:floating,outward:-1}),[]);
});

test('brackets have solid geometry and clear only masks that intersect the profile',()=>{
  const part=C.bracket({point:[0,2,0],out:[0,0,1],tangent:[1,0,0],reach:1},{width:.2,drop:1});
  const mask=(center,half)=>K.procedural.pieces.box(center,half,[1,0,0,0,1,0,0,0,1]).planes;
  assert(part.distance([0,1.98,.4])<0);
  assert(part.distance([0,1.2,.9])>0);
  assert(C.intersects(part,mask([0,1.75,.20],[.12,.18,.12])));
  assert(!C.intersects(part,mask([0,1.15,.90],[.12,.06,.09])));
  assert(!C.intersects(part,mask([.30,1.7,.20],[.04,.2,.15])));
});
