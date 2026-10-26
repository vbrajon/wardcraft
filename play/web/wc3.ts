// Game-relative asset access. Models reference "Textures\Footman.blp"; Reforged ships the SD
// textures as .dds and locale strings under _locales/<locale>.w3mod. This resolves such paths
// to CASC keys, reads them, and hands them to the DOM as object URLs or fonts.

import type { Casc } from "../casc/casc";
import { BlpImage } from "../vendor/mdx-m3-viewer/parsers/blp/image";
import isBlp from "../vendor/mdx-m3-viewer/parsers/blp/isformat";
import { DdsImage } from "../vendor/mdx-m3-viewer/parsers/dds/image";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webm: "video/webm", ogg: "audio/ogg", mp3: "audio/mpeg", ttf: "font/ttf" };

/** Decodes a BLP1 or DXT-compressed DDS texture to a PNG object URL. */
export async function textureUrl(bytes: Uint8Array): Promise<string> {
  let image: ImageData;
  if (isBlp(bytes)) {
    const blp = new BlpImage();
    blp.load(bytes);
    image = blp.getMipmap(0);
  } else {
    const dds = new DdsImage();
    dds.load(bytes);
    const { width, height, data } = dds.getMipmap(0);
    image = new ImageData(new Uint8ClampedArray(data), width, height);
  }
  const canvas = new OffscreenCanvas(image.width, image.height);
  canvas.getContext("2d")!.putImageData(image, 0, 0);
  return URL.createObjectURL(await canvas.convertToBlob());
}

export class Wc3 {
  private urls = new Map<string, Promise<string>>();
  /** The install's text locale wins over the base container, as in the game. */
  private roots: string[];

  constructor(readonly casc: Casc) {
    this.roots = [`war3.w3mod:_locales/${casc.locale}.w3mod:`, "war3.w3mod:"];
  }

  resolve(path: string): string | undefined {
    const rel = path.toLowerCase().replace(/\\/g, "/");
    for (const candidate of [rel, rel.replace(/\.(blp|tga)$/, ".dds")]) {
      for (const root of this.roots) if (this.casc.files.has(root + candidate)) return root + candidate;
    }
    return undefined;
  }

  read(path: string): Promise<Uint8Array<ArrayBuffer>> {
    const key = this.resolve(path);
    if (!key) throw new Error(`${path} not found in the install`);
    return this.casc.read(key);
  }

  /** Object URL for images, video, audio. Cached for the page lifetime. */
  url(path: string): Promise<string> {
    let url = this.urls.get(path);
    if (!url) {
      url = this.read(path).then((bytes) => URL.createObjectURL(new Blob([bytes], { type: MIME[path.split(".").pop()!.toLowerCase()] })));
      this.urls.set(path, url);
    }
    return url;
  }

  /** Object URL for a game texture path (.blp/.dds). Cached. */
  image(path: string): Promise<string> {
    let url = this.urls.get(path);
    if (!url) {
      url = this.read(path).then(textureUrl);
      this.urls.set(path, url);
    }
    return url;
  }
}
