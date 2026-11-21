import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${host}:${port}`);
    const pathname = decodeURIComponent(url.pathname);
    const name = pathname === '/' ? 'index.html' : pathname.slice(1);
    const filepath = resolve(root, name);
    if (!(filepath === root || filepath.startsWith(root + sep)) || name.startsWith('.')) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    const info = await stat(filepath);
    if (!info.isFile() || /(?:^|[/\\])(?:\.git|private|data|backups|exports)(?:[/\\]|$)/.test(filepath)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    res.writeHead(200, {'Content-Type':types[extname(filepath)] || 'application/octet-stream', 'X-Content-Type-Options':'nosniff'});
    res.end(await readFile(filepath));
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}).listen(port, host, () => console.log(`Local only: http://${host}:${port}`));
