# Authored contacts and prop handoffs

`K.anim.contacts.create` applies contact ranges and socket keys over a
normal Ink clip or sequence. It evaluates from the source pose on each call,
so a seek across a transfer gives the same world transform as playback.

```js
let timeline;
const puppet = K.puppet(world, {
  parts,
  pose(time) { timeline.pose(time); }
});
timeline = K.anim.contacts.create({
  puppet,
  duration: clip.dur,
  height: 3,
  sample: time => clip.sample(time, {}, { sourceTime: true }),
  sockets: {
    stand: { point: [1.27, 1.49, -0.2] },
    'right-hand': { part: 'rightForearm', point: [0.57, 1.08, -0.045], rotation: [0, 0, -98] }
  },
  contacts: [{
    id: 'left-foot', upper: 'leftLeg', part: 'leftBoot', point: [-0.25, 0, -0.1],
    target: [-0.25, 0, -0.1], start: 0.38, end: 2.56,
    fadeIn: 0.17, fadeOut: 0.28, pole: [0, 0, -1]
  }],
  prop: {
    part: 'lantern', socket: 'stand',
    keys: [{ id: 'pickup', time: 1.22, to: 'right-hand', settle: 0.42,
      reach: { upper: 'rightArm', pole: [0, -1, -0.3] } }]
  }
});
```

## Pin a range

`point` is a point on the hand or foot in puppet rest coordinates.
`target` is either a fixed world point or a socket ID. With an `upper`
part, Ink drives the connected two-part chain through the puppet's
two-bone IK solver. A contact without `upper` translates the specified
part using the puppet's pin operation. Optional `weight`, `enabled`,
`fadeIn`, and `fadeOut` control the contact independently of the
source keys. Overlapping contacts are solved in authored order.

`timeline.inspect(time)` returns contact strength, requested target,
actual position, and residual distance. It restores the live puppet pose
after resolving the sample. A target outside the limb's reach reports a
residual rather than stretching the chain.

## Key a transfer

The prop is a rigid top-level puppet part. Put its rest pivot at the grip.
A socket can be a world frame or follow a puppet part, with its point
specified in that part's rest coordinates. Sockets accept `point` or
the stage socket's `p`, plus an Euler `rotation` in degrees or slot
axes through `normal` (or `dir`) and `tangent`.

The initial owner is `prop.socket`. At each `keys[].time`, the keyed
socket becomes the owner. Ink captures a relative transform that preserves
the prop's world position and rotation at the key, then eases into the
incoming socket's mount while following that socket. A prop or transfer
may specify a mount with socket-local `position` and Euler `rotation`.

An optional `reach` drives the receiving hand toward the outgoing grip
before the switch. It uses a grip-centered mount and a receiving limb
independent of the outgoing socket. Ink estimates its lead time from the
grip distance and character height. Set `reach.lead` or `settle` to author
those timings explicitly. Closely spaced keys shorten the available reach
and settle intervals. Reach alone can leave a residual on an unreachable
grip, which the handoff preview reports.

`timeline.focus('pickup')` returns the reach-to-settle window and
`timeAt(elapsed)` for a repeating preview. Recreate the timeline after
changing a contact, key, or source pose sampler so switch transforms
are captured against the edited animation.

## Try it

```sh
node cli/ink-studio.js authored-contacts examples/authored-contacts.js --at 1.22
```

For the interactive demo, [build and serve the browser bundle](pose-blocking.md#try-the-browser-example)
and open `http://localhost:8080/examples/authored-contacts.html`.
Edit the foot contact range or the switch time, click the switch key to see
the exact attachment frame, or choose **Loop handoff** to play the whole beat.
