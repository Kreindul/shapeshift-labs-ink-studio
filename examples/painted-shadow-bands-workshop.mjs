import { createRenderer } from '../webgl.mjs';

const $ = id => document.getElementById(id);
const canvas = $('view');
const toolkit = { KIT, PixelLook, SpriteSurface, makeBuilder, makeSculpt };
const demo = paintedShadowBandsDemo(toolkit), world = demo.build(demo.seed,{controls:{single:true}});
const renderer = createRenderer(canvas,{toolkit});
const picker = KIT.procedural.contributions.create(world,{splatCoverage:world.look.splatCoverage});
const band = KIT.surface.shadowBandPaint, track = KIT.surface.prepareLightTrack(world.surfaceLight);
const initial = demo.authored(0), history = [], colors = [0,0,0];
let strokes=initial, read=band.prepare(strokes), active, sign=1, playing=false, animation, lastTick;
const materials = world.surfaces.map(({settings,light}) =>
  KIT.surface.prepare(settings,world.pal,light,world.surfaceEffects,{paletteRoles:world.paletteRoles}).layers
    .find(layer=>layer.id==='diffuse'&&layer.shadowBand));
const rows = [];
for (let i=0;i<world.count;i++) {
  const n=i*8, q=i*16, layer=materials[world.surfaceData[n]-1];
  if (!layer) continue;
  rows.push({ q, layer, at:Array.from(world.data.subarray(q,q+3)), visibility:world.surfaceData[n+4],
    normal:KIT.V.norm(Array.from(world.surfaceData.subarray(n+1,n+4))) });
}

function refresh() {
  const time=$('time').valueAsNumber, direction=track(time), painted=$('show').checked;
  world.anim.update(0,time);
  const data=world.data.slice();
  // Preview this scene's single full-strength diffuse layer on the splat carriers.
  for (const {q,layer,at,visibility,normal} of rows) {
    const level=band.level(KIT.V.dot(normal,direction),visibility,painted?read(at):0);
    layer.lightingRamp.tint(level,colors);
    data[q+7]=Math.round(colors[0]*255)+Math.round(colors[1]*255)*256+Math.round(colors[2]*255)*65536;
  }
  renderer.render({...world,data},{time,colored:false,damp:false});
  for (const key of ['time','radius','bias']) $(key+'-value').value=$(key).valueAsNumber.toFixed(2);
  $('undo').disabled=!history.length;
  $('status').value=strokes.length+' '+(strokes.length===1?'stroke':'strokes');
}

function updatePaint(value, undoable=false) {
  const sampler=band.prepare(value);
  if (undoable) {
    history.push(strokes);
    if (history.length>64) history.shift();
  }
  strokes=value;
  read=sampler;
  refresh();
}

function pick(event) {
  const rect=canvas.getBoundingClientRect(), {dist,fov,target}=world.cam;
  if (event.clientX<rect.left || event.clientX>=rect.right || event.clientY<rect.top || event.clientY>=rect.bottom) return null;
  const scale=2*dist*Math.tan(fov/2)/rect.height;
  const x=target[0]+(event.clientX-rect.left-rect.width*.5)*scale;
  const y=target[1]-(event.clientY-rect.top-rect.height*.5)*scale;
  const hit=picker.ray({origin:[x,y,6],direction:[0,0,-1],limit:1});
  const item=hit.solid??hit.dominant;
  return item && materials[world.surfaceData[item.index*8]-1] ? item.point : null;
}

canvas.addEventListener('pointerdown',event=>{
  if (event.button!==0 || active || strokes.length>=256) return;
  const point=pick(event);
  if (!point) return;
  if (playing) toggle();
  const mark={points:[point],radius:$('radius').valueAsNumber,bias:sign*$('bias').valueAsNumber,softness:.15};
  active={pointer:event.pointerId,mark};
  updatePaint([...strokes,mark],true);
});
window.addEventListener('pointermove',event=>{
  if (active?.pointer!==event.pointerId) return;
  const point=pick(event), {mark}=active;
  if (!point) { active=null; return; }
  if (mark.points.length>=1024 || KIT.V.dist(mark.points.at(-1),point)<mark.radius*.18) return;
  active.mark={...mark,points:[...mark.points,point]};
  updatePaint([...strokes.slice(0,-1),active.mark]);
});
for (const type of ['pointerup','pointercancel'])
  window.addEventListener(type,event=>{if (active?.pointer===event.pointerId) active=null;});

function tick(now) {
  if (lastTick===undefined || now-lastTick>=1000/24) {
    if (lastTick!==undefined) $('time').value=($('time').valueAsNumber+(now-lastTick)/1000)%demo.period;
    lastTick=now;
    refresh();
  }
  animation=requestAnimationFrame(tick);
}
function toggle() {
  playing=!playing;
  $('play').textContent=playing?'Pause':'Play';
  $('play').setAttribute('aria-pressed',playing);
  lastTick=undefined;
  if (playing) animation=requestAnimationFrame(tick);
  else cancelAnimationFrame(animation);
}
$('play').onclick=toggle;
$('modes').onclick=event=>{
  const button=event.target.closest('button[data-sign]');
  if (!button) return;
  sign=Number(button.dataset.sign);
  for (const choice of $('modes').querySelectorAll('button')) choice.setAttribute('aria-pressed',choice===button);
};
for (const key of ['time','radius','bias','show']) $(key).addEventListener('input',refresh);
$('undo').onclick=()=>{if (history.length) updatePaint(history.pop());};
$('reset').onclick=()=>updatePaint(initial,true);
$('save').onclick=()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify({strokes},null,2)],{type:'application/json'}));
  const link=document.createElement('a');
  link.href=url;
  link.download='shadow-band-paint.json';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};
refresh();
