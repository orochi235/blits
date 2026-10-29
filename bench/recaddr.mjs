// Where in memory the records a lane reads in order sit: for each lane of glowb^'s scene after
// warm-up, the address of each record (and of the voice's last delta) from %DebugPrint, then the
// gaps between successive records, so a layout that scatters them shows as larger or uneven gaps.
//   node --allow-natives-syntax bench/recaddr.mjs [frames] [records]
// Reads ./dist, so run it from a built tree, or BLITS names the module.
const { kit, max, mix, mul, patch } = await import(process.env.BLITS ?? '../dist/index.js');

const FRAMES = Number(process.argv[2] ?? 300);
const SHOW = Number(process.argv[3] ?? 2000);
const N = 10000;
const side = Math.round(Math.sqrt(N));
const subjects = Array.from({ length: N }, (_, j) => ({
  seed: j * 0.37,
  x: j % side,
  y: Math.floor(j / side),
}));
const xy = new Float64Array(2 * N);
for (let j = 0; j < N; j++) {
  xy[2 * j] = subjects[j].x;
  xy[2 * j + 1] = subjects[j].y;
}
const m = mix(kit({ gain: mul(), dark: max() }));
const R = 8;
const pointer = { x: 0, y: 0, r: R };
m.plot(subjects, xy, R);
m.cue({
  patch: patch(
    180,
    (ph, s) => ({ gain: 0.2 + 0.8 * Math.abs(Math.sin(ph * Math.PI + s.seed)), dark: ph * 0.1 }),
    { writes: ['gain', 'dark'] },
  ),
  loop: true,
});
m.cue({
  patch: patch(1000, () => ({ gain: 1.5 }), { writes: ['gain'] }),
  weight: (s) => Math.max(0, 1 - Math.hypot(s.x - pointer.x, s.y - pointer.y) / R),
  loop: true,
  within: pointer,
});
const columns = { gain: new Float64Array(N), dark: new Float64Array(N) };
let t = 0;
for (let f = 0; f < FRAMES; f++) {
  t += 16.7;
  const a = t / 2000;
  pointer.x = side / 2 + (side / 3) * Math.cos(a);
  pointer.y = side / 2 + (side / 3) * Math.sin(a);
  m.sync(t);
  m.pull(subjects, columns);
}

// %DebugPrint writes each address to stdout from C++; bench/recgaps.mjs reads the lines after.
for (const lane of m.lanes.lanes) {
  const recs = lane.records.filter(Boolean).slice(0, SHOW);
  console.log(`LANE ${lane.voice.id} records ${lane.records.filter(Boolean).length}`);
  for (const r of recs) eval('%DebugPrint(r)');
}
