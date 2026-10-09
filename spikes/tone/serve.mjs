// Serves the repo root, so the page can load blits' dist and Tone's standalone build.
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html' };
const port = Number(process.env.PORT ?? 4890);
createServer((req, res) => {
  const path = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!path.startsWith(root) || !statSync(path, { throwIfNoEntry: false })?.isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
  createReadStream(path).pipe(res);
}).listen(port, '::', () => console.log(`http://localhost:${port}/spikes/tone/`));
