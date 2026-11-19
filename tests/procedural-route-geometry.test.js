const test = require('node:test');
const assert = require('node:assert/strict');
const { routes } = require('..').load().KIT.procedural;
const box = [[-1,-1],[1,-1],[1,1],[-1,1]];

test('visibility graphs choose the shortest plan path around polygons and keep exact pins', () => {
  const a = [-4, 0.1, 0], b = [4, 0.4, 0],
    path = routes.visibility(a, b, [box]);
  assert.equal(path.status, 'ok');
  const points = path.route.points;
  assert.equal(points.length, 4);
  assert.deepEqual(points[0], a);
  assert.deepEqual(points.at(-1), b);
  assert(points.slice(1, -1).every(p => Math.abs(p[0]) === 1 && Math.abs(p[2]) === 1));
  const run = points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[2] - points[i][2]), 0);
  assert.equal(run, 2 * Math.sqrt(10) + 2);
  assert.equal(routes.visibility([0, 0, 0], b, [box]).status, 'blocked-pin');
  assert.equal(routes.visibility(a, b, [box], { maxTests: 1 }).status, 'budget');
  assert.equal(routes.visibility([0, 0, -1], [3, 0, -1], [box]).route.points.length, 2);
});

test('the visibility test respects concave outlines and corridors between close obstacles', () => {
  const concave = [[0,0],[3,0],[3,2],[2,2],[2,1],[1,1],[1,2],[0,2]],
    p = routes.visibility([1.5, 0, 3], [1.5, 0, 1.2], [concave]),
    q = routes.visibility([-3, 0, 3], [5, 0, 3], [concave, [[-2,3.1],[5,3.1],[5,4],[-2,4]]]);
  assert.equal(p.route.points.length, 2);
  assert.equal(q.route.points.length, 2);
});

test('spline fitting rounds safe corners while retaining a corner that would enter a keep-out', () => {
  const raw = routes.polyline([[-2, 0, 0], [-1, 0, 0], [-1, 0, 1], [2, 0, 1]]),
    options = { radius: 0.7, spacing: 0.035, keepOut: (x, z) => x < -1 && z > 0 },
    rounded = routes.spline(raw, options);
  assert.equal(rounded.status, 'ok');
  assert.equal(rounded.work.retained, 1);
  assert.equal(rounded.work.rounded, 1);
  assert.equal(rounded.quadratics.length, 1);
  assert.deepEqual(rounded.route.points[0], raw.points[0]);
  assert.deepEqual(rounded.route.points.at(-1), raw.points.at(-1));
  for (let i = 0; i <= 300; i++) {
    const [x, , z] = rounded.route.sample(i / 300).point;
    assert(!options.keepOut(x, z));
  }
  assert.equal(routes.spline(raw, { clearance: () => -1 }).status, 'blocked');
});

test('fast marching solves a uniform Eikonal field and traces a route through continuous coordinates', () => {
  const bounds = { min: [-3, -3], max: [3, 3] },
    field = routes.travelTime([[0, 0]], { bounds, cell: 0.06 });
  assert.equal(field.time(0, 0), 0);
  assert(Math.abs(field.time(2.4, 0) - 2.4) < 1e-9);
  assert(Math.abs(field.time(2, 2) - Math.sqrt(8)) < 0.14);
  const start = [-2.15, -1.74],
    plan = field.trace(start, { height: (x, z) => 0.19 * z }),
    output = plan.route.points;
  assert.equal(plan.status, 'ok');
  assert.deepEqual(output[0], [start[0], 0.19 * start[1], start[1]]);
  assert.deepEqual(output.at(-1), [0, 0, 0]);
  for (let i = 1; i < output.length; i++) {
    assert(field.time(output[i][0], output[i][2]) <= field.time(output[i - 1][0], output[i - 1][2]) + 1e-8);
  }
});

test('fast marching traces around a blocked disk, chooses seeded outlets, and reports unreachable cells', () => {
  const bounds = { min: [-5, -4], max: [5, 4] },
    speed = (x, z) => Math.hypot(x, z) > 1.21 ? (z < -2 ? 0.6 : 1) : 0,
    field = routes.travelTime([[4, 0.13], [4, 3.1]], { bounds, cell: 0.18, speed });
  const plan = field.trace([-4, 0]);
  assert.equal(plan.status, 'ok');
  assert(Math.abs(plan.route.length - 8) > 0.1);
  for (let i = 0; i <= 500; i++) {
    const [x, , z] = plan.route.sample(i / 500).point;
    assert(speed(x, z) > 0);
  }
  assert.equal(field.trace([0, 0]).status, 'blocked');
  const wall = routes.travelTime([[3, 0]], { bounds, cell: 0.22, speed: x => Math.abs(x) < 0.14 ? 0 : 1 });
  assert.equal(wall.time(-2, 0), Infinity);
  assert.equal(wall.trace([-2, 0]).status, 'unreachable');
});

test('shared convex footprints reserve a disk margin around unordered and acute samples', () => {
  const samples = [[3, 0], [-1, 1], [-1, -1], [0, 0], [-1, -1]];
  const margin = 0.7, outline = routes.convexFootprint(samples, { margin });
  assert.deepEqual(routes.convexFootprint(samples), [[-1, -1], [3, 0], [-1, 1]]);
  for (const [x, z] of samples) for (let i = 0; i < 64; i++) {
    const angle = 2 * Math.PI * i / 64, q = [x + margin * Math.cos(angle), z + margin * Math.sin(angle)];
    assert(outline.every(([ax, az], j) => {
      const [bx, bz] = outline[(j + 1) % outline.length];
      return (bx - ax) * (q[1] - az) - (bz - az) * (q[0] - ax) >= -1e-8;
    }));
  }
  const a = [-4, 0.2, 0], b = [5, 1.4, 0],
    path = routes.visibility(a, b, [outline, routes.convexFootprint([[1, 1], [2, 1], [2, 3], [1, 3]], { margin })]);
  assert.equal(path.status, 'ok');
  assert.deepEqual(path.route.points[0], a);
  assert.deepEqual(path.route.points.at(-1), b);
  assert(path.route.points.length > 2);
});

test('convex clearance checks permit exact boundary travel and reject interior chords in either winding', () => {
  const loop = Array.from({length: 96}, (_, i) => {
    const angle = i * Math.PI * 2 / 96;
    return [5e5 + 3 * Math.cos(angle), -5e5 + 3 * Math.sin(angle)];
  });
  const pin = ([x, z], y = 0) => [x, y, z];
  for (const polygon of [loop, loop.slice().reverse()]) {
    const a = pin(loop[0]), edge = pin(loop[1]), b = pin(loop[24], 1);
    assert.equal(routes.visibility(a, edge, [polygon]).route.points.length, 2);
    const route = routes.visibility(a, b, [polygon], { maxTests: 250000 });
    assert.equal(route.status, 'ok');
    assert.equal(route.route.points.length, 25);
    assert.deepEqual(route.route.points[0], a);
    assert.deepEqual(route.route.points.at(-1), b);
    assert.equal(routes.visibility(pin([5e5, -5e5]), b, [polygon]).status, 'blocked-pin');
  }
});

test('visibility links bypass only their own obstacle and report the chosen point indices', () => {
  const wall = [[-2,-4],[2,-4],[2,4],[-2,4]], origin = [-3,0,1], end = [3,0.4,1];
  const links = [{start: [-3,1], end: [3,1], through: 0}];
  const pass = routes.visibility(origin, end, [wall], { links });
  assert.deepEqual(pass.route.points, [origin,end]);
  assert.deepEqual(pass.links, [{link: 0, from: 0, to: 1}]);
  const reverse = routes.visibility(end, origin, [wall], { links });
  assert.equal(reverse.links[0].link,0);
  assert.deepEqual(reverse.route.points, [end,origin]);
  const other = [[-.1, .8],[.1,.8],[.1,1.2],[-.1,1.2]];
  const blocked = routes.visibility(origin, end, [wall,other], { links });
  assert(!blocked.links);
  assert(blocked.route.length > pass.route.length);
});

test('a link can cross a composite obstacle while every other polygon remains solid', () => {
  const rectangle = (x0, x1, z0, z1) => [[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
  const walls = [rectangle(-2,.1,-2,2),rectangle(-.1,2,-2,2)];
  const origin = [-3,0,0], end = [3,.2,0], start = [-3,0], finish = [3,0];
  const link = {start, end:finish, through:[0,1]};
  const pass = routes.visibility(origin,end,walls,{links:[link]});
  assert.deepEqual(pass.route.points,[origin,end]);
  assert.deepEqual(pass.links,[{link:0,from:0,to:1}]);
  const partly = routes.visibility(origin,end,walls,{links:[{...link,through:[0]}]});
  assert.equal(partly.links,undefined);
  const blocked = routes.visibility(origin,end,walls.concat([rectangle(-.2,.2,-.3,.3)]),{links:[link]});
  assert.equal(blocked.links,undefined);
  for(const through of [[],[1,1],[0,2],new Array(1)])
    assert.throws(()=>routes.visibility(origin,end,walls,{links:[{...link,through}]}),/obstacle indices/);
});

test('swept clearance probes both sides and headroom along a sloping span', () => {
  const start = [0,.8,0], end = [3,1.4,0];
  const section = {halfWidth: .5, below: .2, above: .35, spacing: .1, minClearance: .02};
  const tunnel = ([x,y,z]) => x < 1 || x > 2 ? Infinity : Math.min(.6 - Math.abs(z), 1.8 - y, y - .5);
  assert.equal(routes.sweep(start, end, {...section,clearance:tunnel}).status,'ok');
  const tight = routes.sweep(start, end, {...section,halfWidth:.65,clearance:tunnel});
  assert.equal(tight.status,'blocked');
  assert(Math.abs(tight.point[2]) >= .5);
  assert.equal(routes.sweep(start, end, {...section,above:.9,clearance:tunnel}).status,'blocked');
  assert.equal(routes.sweep(start, end, {...section,maxSamples:2,clearance:tunnel}).status,'budget');
});

test('bent visibility links keep private waypoints and use their length for the grade', () => {
  const wall=[[-2,-4],[2,-4],[2,4],[-2,4]],start=[-3,.5,0],end=[3,1.1,0];
  const link={start:[-3,0],end:[3,0],via:[[-1,.6],[1,.6]],through:0};
  const result=routes.visibility(start,end,[wall],{links:[link]});
  const points=result.route.points;
  assert.deepEqual(result.links,[{link:0,from:0,to:3}]);
  assert.deepEqual(points.map(([x,,z])=>[x,z]),[link.start,...link.via,link.end]);
  assert.deepEqual(points[0],start);
  assert.deepEqual(points.at(-1),end);
  const first=Math.hypot(2,.6),run=first*2+2;
  assert(Math.abs(points[1][1]-(.5+.6*first/run))<1e-9);
  const reversed=routes.visibility(end,start,[wall],{links:[link]});
  assert.deepEqual(reversed.route.points.map(([x,,z])=>[x,z]),[link.end,...link.via.slice().reverse(),link.start]);
  const obstacle=[[-.2,.45],[.2,.45],[.2,.75],[-.2,.75]];
  assert.equal(routes.visibility(start,end,[wall,obstacle],{links:[link]}).links,undefined);
  const long={...link,via:[[-1,3.9],[1,-3.9]]};
  assert.equal(routes.visibility(start,end,[wall],{links:[long]}).links,undefined);
  assert.throws(()=>routes.visibility(start,end,[wall],{links:[link],maxVertices:9}),/vertex budget/);
  assert.throws(()=>routes.visibility(start,end,[wall],{links:[{...link,via:[link.start]}]}),/nonzero spans/);
});

test('path section clearance probes the exposed corner join under a shared sample limit', () => {
  const points=[[-1,.3,0],[0,.3,0],[0,.3,1]],clearance=([x,,z])=>Math.hypot(x-.25,z+.25)-.08;
  const options={halfWidth:.4,below:.12,above:.45,spacing:.06,clearance};
  assert.equal(routes.sweep(points[0],points[1],options).status,'ok');
  assert.equal(routes.sweep(points[1],points[2],options).status,'ok');
  const blocked=routes.sweepPath(points,options);
  assert.equal(blocked.status,'blocked');
  assert(blocked.point[0]>0&&blocked.point[2]<0);
  const open=routes.sweepPath(points,{...options,clearance:()=>Infinity});
  assert.equal(open.status,'ok');
  const budget=routes.sweepPath(points,{...options,clearance:()=>Infinity,maxSamples:open.samples-1});
  assert.equal(budget.status,'budget');
  assert(budget.samples<open.samples);
});

test('visibility waypoints connect through a composed clearance domain and respect erasure',()=>{
  const start=[-2,.3,0],end=[0,.7,2],waypoints=[[0,0],[-1.6,1.6]];
  const clearance=(x,z)=>.52-Math.min(
    Math.hypot(x-Math.max(-2,Math.min(x,0)),z),
    Math.hypot(x,z-Math.max(0,Math.min(z,2)))
  );
  const domain={clearance,minClearance:.2,spacing:.055},options={domain,waypoints};
  const route=routes.visibility(start,end,[],options);
  assert.equal(route.status,'ok');
  assert.deepEqual(route.route.points,[start,[0,.5,0],end]);
  const erase=(x,z)=>Math.min(clearance(x,z),Math.hypot(x,z)-.24);
  assert.equal(routes.visibility(start,end,[],{...options,domain:{...domain,clearance:erase}}).status,'unreachable');
  const wall=[[-.75,-.75],[.75,-.75],[.75,.75],[-.75,.75]];
  const links=[{start:[-2,0],end:[0,2],via:[[0,0]],through:0}];
  assert.deepEqual(routes.visibility(start,end,[wall],{links,domain}).links,[{link:0,from:0,to:2}]);
  assert.equal(routes.visibility(start,end,[wall],{links,domain:{...domain,clearance:erase}}).status,'unreachable');
  assert.equal(routes.visibility(start,end,[],{...options,maxTests:2}).status,'budget');
  assert.equal(routes.visibility([-3,0,0],end,[],options).status,'blocked-pin');
  assert.throws(()=>routes.visibility(start,end,[],{...options,maxVertices:3}),/vertex budget/);
  assert.throws(()=>routes.visibility(start,end,[],{domain:{clearance:()=>NaN}}),/signed distance/);
});
