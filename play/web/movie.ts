// Plays a game cinematic: VP9 frames from the AVI through WebCodecs, audio from the matching .ogg
// through an <audio> element that also serves as the clock. Resolves when the movie ends or is skipped.

import { parseAvi } from "./avi";
import type { Wc3 } from "./wc3";

const resolution = () => (innerWidth * devicePixelRatio <= 640 ? 640 : innerWidth * devicePixelRatio <= 1280 ? 1280 : 1920);

export async function playMovie(wc3: Wc3, name: string, canvas: HTMLCanvasElement, skip: AbortSignal): Promise<void> {
  if (typeof VideoDecoder === "undefined" || skip.aborted) return;
  const bytes = await wc3.read(`Movies\\${name}_${resolution()}.avi`);
  const avi = parseAvi(bytes);
  if (avi.codec !== "VP90") throw new Error(`${name}: codec ${avi.codec} unsupported`);
  const config: VideoDecoderConfig = { codec: "vp09.00.10.08", codedWidth: avi.width, codedHeight: avi.height };
  if (!(await VideoDecoder.isConfigSupported(config)).supported) return;
  const oggKey = wc3.resolve(`Movies\\Audio\\${name}.ogg`);
  const audio = oggKey ? new Audio(URL.createObjectURL(new Blob([await wc3.casc.read(oggKey)], { type: "audio/ogg" }))) : null;

  const ctx = canvas.getContext("2d")!;
  const frameUs = 1e6 / avi.fps;
  const endUs = avi.frames.length * frameUs;
  const pending: VideoFrame[] = [];
  const { promise: done, resolve } = Promise.withResolvers<void>();
  let flushed = false;
  const decoder = new VideoDecoder({ output: (f) => pending.push(f), error: (e) => { console.error(e); resolve(); } });
  decoder.configure(config);

  let fed = 0, flushing = false;
  // Back-pressure on both ends: few undecoded chunks in the decoder, few decoded frames waiting to show.
  const feed = () => {
    while (fed < avi.frames.length && decoder.decodeQueueSize < 8 && pending.length < 8) {
      const { offset, size, key } = avi.frames[fed];
      decoder.decode(new EncodedVideoChunk({ type: key ? "key" : "delta", timestamp: fed * frameUs, data: bytes.subarray(offset, offset + size) }));
      fed++;
    }
    if (fed === avi.frames.length && !flushing) {
      flushing = true;
      decoder.flush().then(() => (flushed = true), () => (flushed = true));
    }
  };
  decoder.addEventListener("dequeue", feed);

  const draw = (f: VideoFrame) => {
    const scale = Math.min(canvas.width / f.displayWidth, canvas.height / f.displayHeight);
    const w = f.displayWidth * scale, h = f.displayHeight * scale;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(f, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  };

  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
  feed();
  await audio?.play().catch(() => {});
  const start = performance.now();
  const clockUs = () => (audio && audio.currentTime > 0 ? audio.currentTime * 1e6 : (performance.now() - start) * 1e3);

  const tick = () => {
    if (skip.aborted) return resolve();
    const now = clockUs();
    let next: VideoFrame | undefined;
    while (pending.length && pending[0].timestamp <= now) {
      next?.close();
      next = pending.shift();
    }
    if (next) {
      draw(next);
      next.close();
      feed();
    }
    if (flushed && !pending.length && now >= endUs) return resolve();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  await done;

  decoder.removeEventListener("dequeue", feed);
  if (decoder.state !== "closed") decoder.close();
  for (const f of pending) f.close();
  if (audio) {
    audio.pause();
    URL.revokeObjectURL(audio.src);
  }
}
