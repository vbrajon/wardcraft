// Browser-side CASC source over the user's own Warcraft III folder: the FileList from
// <input webkitdirectory>. Nothing is uploaded; files are sliced on demand.

import type { Source } from "../casc/casc";

async function slice(file: File, offset: number, length?: number): Promise<Uint8Array<ArrayBuffer>> {
  const part = length === undefined ? file : file.slice(offset, offset + length);
  return new Uint8Array(await part.arrayBuffer());
}

export function listSource(list: FileList): Source {
  const files = new Map<string, File>();
  for (const f of list) files.set(f.webkitRelativePath.split("/").slice(1).join("/"), f);
  return {
    async read(path, offset = 0, length) {
      const file = files.get(path);
      if (!file) throw new Error(`${path} not in the chosen folder`);
      return slice(file, offset, length);
    },
    async list(path) {
      const prefix = `${path}/`;
      return [...files.keys()].filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/")).map((k) => k.slice(prefix.length));
    },
  };
}
