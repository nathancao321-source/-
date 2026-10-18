import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist');
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');

const jsMatch = html.match(/<script[^>]+src="([^"]+)"[^>]*><\/script>/);
const cssMatch = html.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/);
if (!jsMatch || !cssMatch) {
  throw new Error('Could not find built JS/CSS assets in dist/index.html');
}

const clean = (asset) => asset.replace(/^\.\//, '');
const js = fs
  .readFileSync(path.join(dist, clean(jsMatch[1])), 'utf8')
  .replace(/<\/script/gi, '<\\/script');
const css = fs
  .readFileSync(path.join(dist, clean(cssMatch[1])), 'utf8')
  .replace(/<\/style/gi, '<\\/style');

const output = `<title>THE LAST ARK</title>
<style>
${css}
</style>
<main id="app">
  <canvas id="game" aria-label="THE LAST ARK 游戏画面" tabindex="0"></canvas>
  <div id="boot-error" hidden></div>
</main>
<script type="module">
${js}
</script>
`;

const outPath = path.resolve('docs/playable.html');
fs.writeFileSync(outPath, output, 'utf8');
console.log(`Wrote ${outPath} (${Buffer.byteLength(output)} bytes)`);
