// BLTE container decoder (https://wowdev.wiki/BLTE). Modes: N raw, Z zlib, F nested.
// Works in Bun and browsers: zlib via DecompressionStream, no dependencies.

async function inflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decodeBlock(block: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const body = block.subarray(1);
  switch (block[0]) {
    case 0x4e: return body; // N
    case 0x5a: return inflate(body); // Z
    case 0x46: return decodeBlte(body); // F
    default: throw new Error(`BLTE mode ${String.fromCharCode(block[0])} unsupported`);
  }
}

export async function decodeBlte(buf: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0) !== 0x424c5445) throw new Error("not a BLTE buffer");
  const headerSize = dv.getUint32(4);
  if (headerSize === 0) return decodeBlock(buf.subarray(8));
  const count = dv.getUint32(8) & 0xffffff;
  const blocks: [number, number][] = [];
  let total = 0;
  for (let i = 0, p = 12; i < count; i++, p += 24) {
    blocks.push([dv.getUint32(p), dv.getUint32(p + 4)]);
    total += dv.getUint32(p + 4);
  }
  const out = new Uint8Array(total);
  let o = 0;
  let q = headerSize;
  for (const [raw, logical] of blocks) {
    out.set(await decodeBlock(buf.subarray(q, q + raw)), o);
    o += logical;
    q += raw;
  }
  return out;
}
