// CASC inspection from Bun.
//   bun play/casc/cli.ts ls [prefix]          list paths with sizes
//   bun play/casc/cli.ts cat <path>           write a file to stdout
//   bun play/casc/cli.ts get <path> <out>     extract a file to disk
// Install root defaults to /Applications/Warcraft III; override with WC3_ROOT.

import { Casc } from "./casc";
import { fileSource } from "./fs";

const source = fileSource(process.env.WC3_ROOT ?? "/Applications/Warcraft III");

const [cmd, arg, out] = process.argv.slice(2);
const casc = await Casc.open(source);

if (cmd === "cat") process.stdout.write(await casc.read(arg));
else if (cmd === "get") await Bun.write(out, await casc.read(arg));
else {
  const prefix = (arg ?? "").toLowerCase();
  for (const [path, spans] of casc.files) {
    if (path.startsWith(prefix)) console.log(`${spans.reduce((n, s) => n + s.size, 0)}\t${path}`);
  }
}
