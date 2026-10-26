// Build learn/*.md into site/<deck>/index.html and site/index.html.
// Usage: bun learn/build.ts   Deploy (with play/build.ts): wrangler pages deploy site --project-name warcraft-2026 --branch main

import { mkdir, readdir } from "node:fs/promises";

const ROOT = `${import.meta.dir}/..`;

type Slide = { title: string; body: string[]; notes: string };
type Deck = { name: string; title: string; subtitle: string; slides: Slide[] };

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(s: string): string {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/(^|[^"=>])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank">$2</a>');
}

function parseDeck(name: string, src: string): Deck {
  const chunks = src.split(/^---\s*$/m).map((c) => c.trim()).filter(Boolean);
  const fm = Object.fromEntries(
    chunks[0].split("\n").map((l) => l.split(/:\s*/, 2) as [string, string]).map(([k, v]) => [k, v.replace(/^["']|["']$/g, "")]),
  );
  const slides = chunks.slice(1).map((chunk): Slide => {
    const notes = chunk.match(/<!--\s*notes\s*([\s\S]*?)-->/)?.[1].trim() ?? "";
    const text = chunk.replace(/<!--[\s\S]*?-->/g, "").trim();
    let title = "";
    const body: string[] = [];
    let list: string[] = [];
    let pre: string[] | null = null;
    const flush = () => { if (list.length) { body.push(`<ul${list.length > 8 ? ' class="dense"' : ""}>${list.map((b) => `<li>${inline(b)}</li>`).join("")}</ul>`); list = []; } };
    for (const line of text.split("\n")) {
      if (pre) { if (line.trim().startsWith("```")) { body.push(`<pre>${esc(pre.join("\n"))}</pre>`); pre = null; } else pre.push(line); continue; }
      const l = line.trim();
      if (!l) continue;
      if (l.startsWith("```")) { flush(); pre = []; continue; }
      if (l.startsWith("# ")) { title = inline(l.slice(2)); continue; }
      if (l.startsWith("## ")) { flush(); body.push(`<h2>${inline(l.slice(3))}</h2>`); continue; }
      if (/^[-*] /.test(l)) { list.push(l.slice(2)); continue; }
      flush(); body.push(`<p>${inline(l)}</p>`);
    }
    flush();
    return { title, body, notes };
  });
  return { name, title: fm.title ?? name, subtitle: fm.subtitle ?? "", slides };
}

const CSS = `
html{font-size:min(2.9vw,2.9vh)}
:root{--bg:#0f1115;--fg:#e8e6e3;--muted:#8a8f98;--accent:#f4b942;--link:#6cb6ff}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:400 1rem/1.4 -apple-system,"Helvetica Neue",Segoe UI,sans-serif}
.slide{display:none;position:absolute;inset:0;padding:6cqmin 7vw 9cqmin;flex-direction:column;justify-content:center}
.slide.on{display:flex}
h1{font-size:5.6cqmin;line-height:1.1;margin:0 0 3cqmin;color:var(--accent);letter-spacing:-.01em}
h2{font-size:3.2cqmin;margin:1.5cqmin 0 .8cqmin;color:var(--accent);opacity:.85}
ul{margin:0;padding:0;list-style:none}li{margin:0 0 1.4cqmin;padding-left:3cqmin;position:relative}
li::before{content:"";position:absolute;left:0;top:1.15cqmin;width:1cqmin;height:1cqmin;border-radius:50%;background:var(--accent)}
b{color:#fff}a{color:var(--link);text-decoration:none;border-bottom:1px solid #345}code{font-size:.9em;background:#1b1f27;padding:.1em .4em;border-radius:.3em}
pre{align-self:flex-start;max-width:100%;margin:0 0 2cqmin;padding:2cqmin 2.5cqmin;background:#161a22;border:1px solid #262b36;border-radius:1cqmin;font:2.3cqmin/1.3 ui-monospace,Menlo,monospace;color:#d6d9de;white-space:pre;overflow:hidden}
.slide.cover{align-items:flex-start}.cover h1{font-size:11cqmin;margin-bottom:2cqmin}.cover ul{font-size:4cqmin;color:var(--muted)}.cover li::before{display:none}.cover li{padding-left:0}
.foot{position:absolute;left:7vw;right:7vw;bottom:3.5cqmin;display:flex;justify-content:space-between;font-size:2cqmin;color:var(--muted)}
.bar{position:absolute;left:0;bottom:0;height:.6vh;background:var(--accent)}
ul.dense{font-size:2.2cqmin;columns:2;column-gap:4vw}.dense li{margin-bottom:1cqmin;break-inside:avoid;overflow-wrap:anywhere}.dense li::before{top:.9cqmin;width:.8cqmin;height:.8cqmin}
.notes{position:absolute;left:7vw;right:7vw;bottom:7cqmin;font-size:2cqmin;color:var(--muted);display:none}.show-notes .notes{display:block}
@media print{.slide{display:flex;position:relative;height:100vh;page-break-after:always}.notes{display:block}}
`;

const JS = `
const S=[...document.querySelectorAll('.slide')],n=S.length;let i=0;
function go(k){i=Math.max(0,Math.min(n-1,k));S.forEach((s,j)=>s.classList.toggle('on',j===i));history.replaceState(null,'','#'+(i+1));document.querySelector('.bar').style.width=((i+1)/n*100)+'%';document.querySelector('.num').textContent=(i+1)+' / '+n;}
addEventListener('keydown',e=>{if(['ArrowRight','ArrowDown',' ','PageDown'].includes(e.key))go(i+1);if(['ArrowLeft','ArrowUp','PageUp'].includes(e.key))go(i-1);if(e.key==='Home')go(0);if(e.key==='End')go(n-1);if(e.key==='n')document.body.classList.toggle('show-notes')});
addEventListener('click',e=>{if(e.target.closest('a'))return;go(e.clientX>innerWidth/2?i+1:i-1)});
addEventListener('hashchange',()=>go((parseInt(location.hash.slice(1))||1)-1));
go((parseInt(location.hash.slice(1))||1)-1);
`;

function renderDeck(d: Deck): string {
  const slides = d.slides.map((s, k) =>
    `<section class="slide${k === 0 ? " cover" : ""}"><h1>${s.title}</h1>${s.body.join("")}<div class="notes">${inline(s.notes)}</div></section>`
  ).join("\n");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${d.title}</title><style>${CSS}</style></head><body>
${slides}
<div class="foot"><span><a href="../">↑</a> ${d.title}</span><span class="num"></span></div><div class="bar"></div>
<script>${JS}</script></body></html>`;
}

function renderIndex(decks: Deck[]): string {
  const rows = decks.map((d) => `<li><a href="${d.name}/"><b>${d.title}</b></a> <span>${d.subtitle} · ${d.slides.length} slides</span></li>`).join("");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Warcraft 3 — apprendre en 2026</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1115;color:#e8e6e3;font:400 18px/1.5 -apple-system,"Helvetica Neue",Segoe UI,sans-serif}
main{max-width:720px;padding:40px}h1{color:#f4b942;font-size:40px;margin:0 0 8px}p{color:#8a8f98;margin:0 0 32px}
ul{list-style:none;padding:0;margin:0}li{padding:14px 0;border-top:1px solid #222}li span{color:#8a8f98;font-size:15px;display:block}a{color:#6cb6ff;text-decoration:none}
</style></head><body><main><h1>Warcraft 3 — apprendre en 2026</h1><p>Flèches ou clic pour naviguer, <code>n</code> affiche les notes, <code>#12</code> dans l'URL ouvre la slide 12.</p><ul>${rows}</ul></main></body></html>`;
}

const order = ["general", "videos", "human", "orc", "nightelf", "undead"];
const files = (await readdir(import.meta.dir)).filter((f) => f.endsWith(".md"))
  .sort((a, b) => order.indexOf(a.replace(/\.md$/, "")) - order.indexOf(b.replace(/\.md$/, "")));

const decks: Deck[] = [];
for (const f of files) {
  const d = parseDeck(f.replace(/\.md$/, ""), await Bun.file(`${import.meta.dir}/${f}`).text());
  decks.push(d);
  await mkdir(`${ROOT}/site/${d.name}`, { recursive: true });
  await Bun.write(`${ROOT}/site/${d.name}/index.html`, renderDeck(d));
  console.log(`${d.name}: ${d.slides.length} slides`);
}
await Bun.write(`${ROOT}/site/index.html`, renderIndex(decks));
