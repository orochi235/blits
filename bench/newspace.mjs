// Preloaded with NODE_OPTIONS=--import=./bench/newspace.mjs: prints the young generation's size
// and the old generation's use at exit, to see how V8 sized the nursery for a run.
import { getHeapSpaceStatistics } from 'node:v8';

process.on('exit', () => {
  const kB = (n) => `${Math.round(n / 1024)} kB`;
  const spaces = getHeapSpaceStatistics().filter((s) => /new_space|old_space/.test(s.space_name));
  console.log(
    spaces
      .map((s) => `${s.space_name} size ${kB(s.space_size)} used ${kB(s.space_used_size)}`)
      .join('; '),
  );
});
