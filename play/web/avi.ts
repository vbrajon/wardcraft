// AVI (RIFF) demuxer for the game's cinematics: one VP9 video stream, frames in the `movi` list,
// key frames flagged in `idx1`. Audio ships as separate .ogg files, not inside the AVI.

export interface AviFrame { offset: number; size: number; key: boolean }
export interface Avi { width: number; height: number; fps: number; codec: string; frames: AviFrame[] }

const tag = (b: Uint8Array, p: number) => String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);

export function parseAvi(b: Uint8Array): Avi {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (tag(b, 0) !== "RIFF" || tag(b, 8) !== "AVI ") throw new Error("not an AVI file");
  const avi: Avi = { width: 0, height: 0, fps: 0, codec: "", frames: [] };
  const keyOffsets = new Set<number>();
  let movi = 0;
  let video = false;

  const walk = (p: number, end: number) => {
    while (p + 8 <= end) {
      const id = tag(b, p);
      const size = dv.getUint32(p + 4, true);
      if (id === "LIST") {
        const kind = tag(b, p + 8);
        if (kind === "movi") movi = p + 8;
        else walk(p + 12, p + 8 + size);
      } else if (id === "avih") {
        avi.width = dv.getUint32(p + 8 + 32, true);
        avi.height = dv.getUint32(p + 8 + 36, true);
      } else if (id === "strh" && tag(b, p + 8) === "vids") {
        avi.fps = dv.getUint32(p + 8 + 24, true) / dv.getUint32(p + 8 + 20, true);
        video = true;
      } else if (id === "strf" && video) {
        avi.codec = tag(b, p + 8 + 16); // BITMAPINFOHEADER.biCompression; strh's handler is blank in some files
        video = false;
      } else if (id === "idx1") {
        for (let q = p + 8; q < p + 8 + size; q += 16) {
          if (dv.getUint32(q + 4, true) & 0x10) keyOffsets.add(dv.getUint32(q + 8, true));
        }
      }
      p += 8 + size + (size & 1);
    }
  };
  walk(12, b.length);
  if (!movi) throw new Error("AVI has no movi list");

  // idx1 offsets are relative to the `movi` fourcc, pointing at each chunk's own fourcc.
  const moviSize = dv.getUint32(movi - 4, true);
  for (let p = movi + 4; p + 8 <= movi + moviSize; ) {
    const id = tag(b, p);
    const size = dv.getUint32(p + 4, true);
    if (id === "00dc" || id === "00db") avi.frames.push({ offset: p + 8, size, key: keyOffsets.has(p - movi) });
    p += 8 + size + (size & 1);
  }
  if (!keyOffsets.size && avi.frames.length) avi.frames[0].key = true;
  return avi;
}
