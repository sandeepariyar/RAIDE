import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';
import { spawn } from 'node:child_process';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.RAIDE_PORT || 4173);
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.ttf':'font/ttf','.woff':'font/woff','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};
const server = createServer(async (req,res) => {
  if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405);res.end();return;}
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let filename = resolve(root, '.' + path);
    if (filename !== resolve(root) && !filename.startsWith(resolve(root) + sep)) {res.writeHead(403);res.end();return;}
    let info;
    try {info = await stat(filename);} catch {if(extname(filename))throw Error('not found');filename=resolve(root,'index.html');info=await stat(filename);}
    if(info.isDirectory()){filename=resolve(filename,'index.html');info=await stat(filename);}
    res.setHeader('Content-Type', types[extname(filename)] || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache');
    if(req.method==='HEAD'){res.end();return;}
    const stream=createReadStream(filename);
    stream.on('error',()=>res.destroy());
    if(/gzip/.test(req.headers['accept-encoding']||'') && /\.(json|js|css|html|svg)$/.test(filename)){
      res.setHeader('Content-Encoding','gzip');res.setHeader('Vary','Accept-Encoding');stream.pipe(createGzip()).pipe(res);
    }else stream.pipe(res);
  } catch {res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Tiedostoa ei löydy.');}
});
server.on('error',error=>{console.error(`Palvelinta ei voitu käynnistää: ${error.message}`);console.error('Jos portti on käytössä, sulje aiempi RAIDE-ikkuna tai valitse toinen RAIDE_PORT.');process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>{
 const url=`http://127.0.0.1:${port}`;
 console.log(`RAIDE on käynnissä: ${url}\nSulje palvelin painamalla Ctrl+C.`);
 if(process.argv.includes('--open')){
  const command=process.platform==='win32'?['cmd',['/c','start','',url]]:process.platform==='darwin'?['open',[url]]:['xdg-open',[url]];
  const child=spawn(command[0],command[1],{detached:true,stdio:'ignore'});child.on('error',()=>console.log(`Avaa selaimessa ${url}`));child.unref();
 }
});
