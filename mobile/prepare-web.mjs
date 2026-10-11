import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dest = resolve(here, 'www');
await rm(dest, {recursive: true, force: true});
await mkdir(dest, {recursive: true});
for (const name of ['index.html', 'app.js', 'brief_lib.js', 'config.js', 'styles.css', 'visual.js', 'manifest.webmanifest', 'icons', 'img', 'data']) {
  await cp(resolve(root, name), resolve(dest, name), {recursive: true});
}
const cfgPath = resolve(dest, 'config.js');
let cfg = await readFile(cfgPath, 'utf8');
const pattern = /MIRROR_PATH:\s*"data\/api\/"/;
if (!pattern.test(cfg)) throw new Error('MIRROR_PATH changed: review mobile configuration');
cfg = cfg.replace(pattern, 'MIRROR_PATH: "https://dzhek15.github.io/data/api/"');
await writeFile(cfgPath, cfg);
