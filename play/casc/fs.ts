// CASC source over a local install directory, for Bun (CLI and build).

import { readdir } from "node:fs/promises";
import type { Source } from "./casc";

export function fileSource(root: string): Source {
  return {
    async read(path, offset = 0, length) {
      const file = Bun.file(`${root}/${path}`);
      return new Uint8Array(await (length === undefined ? file : file.slice(offset, offset + length)).arrayBuffer());
    },
    list: (dir) => readdir(`${root}/${dir}`),
  };
}
