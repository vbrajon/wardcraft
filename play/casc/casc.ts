// Local CASC storage reader for Warcraft III Reforged (https://wowdev.wiki/CASC, /TVFS).
// Resolves a path through the TVFS manifests to an EKey, the EKey through the .idx
// journals to a data.NNN archive slice, then BLTE-decodes it. No encoding file needed.
// Paths use CascLib's convention: nested containers joined with ':', e.g.
// "war3.w3mod:units/unitdata.slk". Lookups are case-insensitive, '\' equals '/'.

import { decodeBlte } from "./blte";

export interface Source {
  read(path: string, offset?: number, length?: number): Promise<Uint8Array<ArrayBuffer>>;
  list(dir: string): Promise<string[]>;
}

export interface Span { ekey: string; size: number }

interface Slot { archive: number; offset: number; size: number }

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const normalize = (path: string) => path.toLowerCase().replace(/\\/g, "/");

function parseBuildInfo(src: string): Record<string, string> {
  const [head, ...rows] = src.trim().split("\n");
  const keys = head.split("|").map((h) => h.split("!")[0]);
  const row = rows.map((r) => r.split("|")).find((r) => r[keys.indexOf("Active")] === "1")!;
  return Object.fromEntries(keys.map((k, i) => [k, row[i]]));
}

function parseConfig(src: string): Record<string, string> {
  return Object.fromEntries(
    src.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(" = ") as [string, string]),
  );
}

function parseIdx(buf: Uint8Array, into: Map<string, Slot>): void {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const [sizeBytes, offsetBytes, keyBytes, offsetBits] = [buf[0x0c], buf[0x0d], buf[0x0e], buf[0x0f]];
  if (dv.getUint16(8, true) !== 7 || sizeBytes !== 4 || offsetBytes !== 5 || keyBytes !== 9 || offsetBits !== 30)
    throw new Error("unexpected .idx layout");
  const end = 0x28 + dv.getUint32(0x20, true);
  for (let p = 0x28; p < end; p += 18) {
    const packed = buf[p + 9] * 2 ** 32 + dv.getUint32(p + 10);
    into.set(hex(buf.subarray(p, p + 9)), {
      archive: Math.floor(packed / 2 ** 30),
      offset: packed % 2 ** 30,
      size: dv.getUint32(p + 14, true),
    });
  }
}

const offsetFieldSize = (tableSize: number) => (tableSize > 0xffffff ? 4 : tableSize > 0xffff ? 3 : tableSize > 0xff ? 2 : 1);

function readUint(buf: Uint8Array, p: number, n: number): number {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + buf[p + i];
  return v;
}

export class Casc {
  readonly files = new Map<string, Span[]>();
  private mounted = 0;
  private constructor(
    readonly version: string,
    /** Text locale of the install, e.g. "enus", from the .build.info tags. */
    readonly locale: string,
    private src: Source,
    private slots: Map<string, Slot>,
    private vfsKeys: Set<string>,
    private onMount: (mounted: number) => void,
  ) {}

  /** `progress` is called after each index journal and each mounted manifest; total is known from the first call. */
  static async open(src: Source, progress: (done: number, total: number) => void = () => {}): Promise<Casc> {
    const info = parseBuildInfo(text(await src.read(".build.info")));
    const key = info["Build Key"];
    const config = parseConfig(text(await src.read(`Data/config/${key.slice(0, 2)}/${key.slice(2, 4)}/${key}`)));
    const vfsKeys = new Set(
      Object.entries(config).filter(([k]) => /^vfs-(root|\d+)$/.test(k)).map(([, v]) => v.split(" ")[1].slice(0, 18)),
    );
    const newest = new Map<string, string>();
    for (const name of await src.list("Data/data")) {
      if (!name.endsWith(".idx")) continue;
      const bucket = name.slice(0, 2);
      if (!newest.has(bucket) || newest.get(bucket)! < name) newest.set(bucket, name);
    }
    const total = newest.size + vfsKeys.size;
    const slots = new Map<string, Slot>();
    let done = 0;
    for (const name of newest.values()) {
      parseIdx(await src.read(`Data/data/${name}`), slots);
      progress(++done, total);
    }
    const locale = (/([a-z]{2}[A-Z]{2}) text/.exec(info.Tags)?.[1] ?? "enUS").toLowerCase();
    const casc = new Casc(config["build-name"], locale, src, slots, vfsKeys, (mounted) => progress(done + mounted, total));
    await casc.mount(config["vfs-root"].split(" ")[1].slice(0, 18), "");
    return casc;
  }

  private async readSpan(ekey: string): Promise<Uint8Array<ArrayBuffer>> {
    const slot = this.slots.get(ekey);
    if (!slot) throw new Error(`EKey ${ekey} not in local storage`);
    const buf = await this.src.read(`Data/data/data.${String(slot.archive).padStart(3, "0")}`, slot.offset, slot.size);
    // Entries normally start with a 30-byte archive header (reversed EKey, size, checksums) before the
    // BLTE data. Some journals also carry a second entry for the same key pointing straight at the BLTE.
    const start = text(buf.subarray(0, 4)) === "BLTE" ? 0 : 30;
    if (text(buf.subarray(start, start + 4)) !== "BLTE") throw new Error(`no BLTE data for ${ekey} in archive ${slot.archive}`);
    return decodeBlte(buf.subarray(start));
  }

  async read(path: string): Promise<Uint8Array<ArrayBuffer>> {
    const spans = this.files.get(normalize(path));
    if (!spans) throw new Error(`${path} not found`);
    if (spans.length === 1) return this.readSpan(spans[0].ekey);
    const out = new Uint8Array(spans.reduce((n, s) => n + s.size, 0));
    let o = 0;
    for (const s of spans) {
      out.set(await this.readSpan(s.ekey), o);
      o += s.size;
    }
    return out;
  }

  private async mount(ekey: string, prefix: string): Promise<void> {
    const buf = await this.readSpan(ekey);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (dv.getUint32(0) !== 0x54564653 || buf[4] !== 1 || buf[6] !== 9) throw new Error("not a TVFS manifest");
    const pathOff = dv.getUint32(0x0c), pathSize = dv.getUint32(0x10);
    const vfsOff = dv.getUint32(0x14);
    const cftOff = dv.getUint32(0x1c), cftSize = dv.getUint32(0x20);
    const cftOffsSize = offsetFieldSize(cftSize);

    const spansAt = (vfsOffset: number): Span[] => {
      let p = vfsOff + vfsOffset;
      const count = buf[p++];
      if (count < 1 || count > 224) return [];
      const spans: Span[] = [];
      for (let i = 0; i < count; i++, p += 8 + cftOffsSize) {
        const cft = cftOff + readUint(buf, p + 8, cftOffsSize);
        spans.push({ ekey: hex(buf.subarray(cft, cft + 9)), size: dv.getUint32(p + 4) });
      }
      return spans;
    };

    // Radix tree: fragments without node value prefix the next valued entry only.
    const walk = async (p: number, end: number, parent: string): Promise<void> => {
      let base = parent;
      while (p < end) {
        let node = "";
        if (buf[p] === 0) { node += "/"; p++; }
        if (buf[p] !== 0xff) {
          const len = buf[p++];
          node += text(buf.subarray(p, p + len));
          p += len;
        }
        if (buf[p] === 0) { node += "/"; p++; }
        let value = -1;
        if (p < end) {
          if (buf[p] === 0xff) { value = dv.getUint32(p + 1); p += 5; }
          else node += "/";
        }
        const path = base + node;
        base = value < 0 ? path : parent;
        if (value < 0) continue;
        if (value & 0x80000000) {
          const dirEnd = p + (value & 0x7fffffff) - 4;
          await walk(p, dirEnd, path);
          p = dirEnd;
          continue;
        }
        const spans = spansAt(value);
        if (!spans.length) continue;
        this.files.set(normalize(path), spans);
        if (spans.length === 1 && this.vfsKeys.has(spans[0].ekey)) await this.mount(spans[0].ekey, `${path}:`);
      }
    };
    await walk(pathOff, pathOff + pathSize, prefix);
    this.onMount(++this.mounted);
  }
}
