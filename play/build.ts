// Bundle play/web into site/play/ with the first-page art read from the install.
// Usage: bun play/build.ts   Dev: bun play/serve.ts
// Deploy (with learn/build.ts): wrangler pages deploy site --project-name warcraft-2026 --branch main

import { mkdir } from "node:fs/promises";
import { Casc } from "./casc/casc";
import { fileSource } from "./casc/fs";

const ROOT = `${import.meta.dir}/..`;

const game = await Bun.build({ entrypoints: [`${import.meta.dir}/web/main.ts`], outdir: `${ROOT}/site/play`, target: "browser", minify: true });
if (!game.success) throw new AggregateError(game.logs, "game bundle failed");

// The first page shows before any install is picked, so its art ships with the site.
const ASSETS = ["WebUI/webms/mainmenu.webm", "WebUI/common/reforged-logo.png", "Fonts/frizqt__.ttf", ...["normal", "hover", "down"].map((s) => `WebUI/widgets/buttons/wc3_btn_blue_${s}_4k.png`)];
const casc = await Casc.open(fileSource(process.env.WC3_ROOT ?? "/Applications/Warcraft III"));
await mkdir(`${ROOT}/site/play/assets`, { recursive: true });
for (const path of ASSETS) await Bun.write(`${ROOT}/site/play/assets/${path.split("/").at(-1)}`, await casc.read(`war3.w3mod:${path}`));
await Bun.write(`${ROOT}/site/play/index.html`, Bun.file(`${import.meta.dir}/web/index.html`));
console.log(`play: ${game.outputs.map((o) => `${o.path.split("/").at(-1)} ${(o.size / 1024).toFixed(0)} KB`).join(", ")}`);
