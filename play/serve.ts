// Dev server: serves site/ and rebuilds play/web on every request to /play/main.js.
// Usage: bun play/serve.ts [port]   (build everything first: bun learn/build.ts && bun play/build.ts)

const ROOT = `${import.meta.dir}/..`;
const port = Number(process.argv[2] ?? 8787);

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname;
    if (path === "/play/main.js") {
      const out = await Bun.build({ entrypoints: [`${ROOT}/play/web/main.ts`], target: "browser", sourcemap: "inline" });
      if (!out.success) return new Response(out.logs.map(String).join("\n"), { status: 500 });
      return new Response(await out.outputs[0].text(), { headers: { "content-type": "text/javascript" } });
    }
    if (path === "/play/" || path === "/play") return new Response(Bun.file(`${ROOT}/play/web/index.html`));
    if (path.endsWith("/")) path += "index.html";
    const file = Bun.file(`${ROOT}/site${path}`);
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});
console.log(`http://localhost:${port}/play/`);
