// Map selection: melee maps read straight out of their MPQ archives (name, players, preview),
// then the chosen map rendered with the vendored terrain renderer under an RTS camera.

import War3Map from "../vendor/mdx-m3-viewer/parsers/w3x/map";
import type War3MapViewerMap from "../vendor/mdx-m3-viewer/viewer/handlers/w3x/map";
import War3MapViewer from "../vendor/mdx-m3-viewer/viewer/handlers/w3x/viewer";
import { textureUrl, type Wc3 } from "./wc3";

export interface MapEntry { path: string; name: string; players: number; size: [number, number]; preview?: string; random?: boolean }

/** Melee maps shipped with the game, without the low-violence (_lv) duplicates. */
export async function listMaps(wc3: Wc3): Promise<MapEntry[]> {
  const paths = [...wc3.casc.files.keys()].filter((p) => /^war3\.w3mod:maps\/frozenthrone\/[^/]+\.w3x$/.test(p) && !p.includes("_lv.")).map((p) => p.slice("war3.w3mod:".length));
  const maps = await Promise.all(paths.map((path) => describeMap(wc3, path)));
  return maps.sort((a, b) => a.players - b.players || a.name.localeCompare(b.name));
}

export async function describeMap(wc3: Wc3, path: string): Promise<MapEntry> {
  const map = new War3Map();
  map.load(await wc3.read(path), true);
  const info = map.getMapInformation();
  const strings = map.readStringTable();
  const minimap = map.get("war3mapMap.blp") ?? map.get("war3mapMap.dds") ?? map.get("war3mapPreview.tga");
  return {
    path,
    name: (strings?.getString(info.name) ?? info.name).replace(/\|c[0-9a-f]{8}|\|r/gi, ""),
    players: info.players.filter((p) => p.type === 1 || p.type === 2).length,
    size: [info.playableSize[0], info.playableSize[1]],
    preview: minimap ? await textureUrl(minimap.bytes()) : undefined,
  };
}

let terrain: War3MapViewer | undefined;

export interface Terrain { viewer: War3MapViewer; map: War3MapViewerMap }

/** Loads a map into the shared terrain renderer (created on first use, base game tables cached). */
export async function loadTerrain(wc3: Wc3, canvas: HTMLCanvasElement, path: string): Promise<Terrain> {
  if (!terrain) {
    terrain = new War3MapViewer(canvas, (src) => (typeof src === "string" ? wc3.resolve(src) : src), true);
    // The viewer loads its game tables in the constructor and only emits on success; bound the wait.
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    terrain.once("loadedbasefiles", () => resolve());
    setTimeout(() => reject(new Error("terrain tables did not load")), 30000);
    await promise;
  }
  terrain.loadMap(await wc3.read(path));
  return { viewer: terrain, map: terrain.map! };
}

/** Pitched-down camera over a target point: wheel zooms, left drag pans, window resize refits. */
export function rtsCamera({ map, viewer }: Terrain, target: [number, number], distance: number) {
  const canvas = viewer.canvas;
  const scene = map.worldScene;
  const place = () => {
    const pitch = Math.PI * 0.3;
    scene.camera.moveToAndFace([target[0], target[1] - distance * Math.cos(pitch), distance * Math.sin(pitch)], [target[0], target[1], 0], [0, 0, 1]);
  };
  const resize = () => {
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;
    scene.viewport[2] = canvas.width;
    scene.viewport[3] = canvas.height;
    scene.camera.perspective(Math.PI / 4, canvas.width / canvas.height, 50, 100000);
  };
  let manual = false;
  const wheel = (e: WheelEvent) => {
    distance = Math.min(Math.max(distance * (1 + e.deltaY / 500), 800), 40000);
    place();
  };
  const drag = (e: PointerEvent) => {
    if (e.buttons !== 1) return;
    manual = true;
    target[0] -= (e.movementX * distance) / 800;
    target[1] += (e.movementY * distance) / 800;
    place();
  };
  addEventListener("resize", resize);
  canvas.addEventListener("wheel", wheel);
  canvas.addEventListener("pointermove", drag);
  resize();
  place();
  return {
    scene,
    /** Glides the view toward a point unless the user has dragged the camera. */
    follow(x: number, y: number) {
      if (manual) return;
      target[0] += (x - target[0]) * 0.05;
      target[1] += (y - target[1]) * 0.05;
      place();
    },
    dispose() {
      removeEventListener("resize", resize);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("pointermove", drag);
    },
  };
}

/** Renders a map's terrain, doodads and units; resolves on Select (true) or Back (false). */
export async function viewMap(wc3: Wc3, path: string, root: HTMLElement): Promise<boolean> {
  const terrain = await loadTerrain(wc3, root.querySelector("canvas")!, path);
  const { map, viewer } = terrain;
  root.querySelector<HTMLElement>(".actions")!.hidden = false;
  root.hidden = false; // the camera measures the canvas, so the screen must be visible first
  const camera = rtsCamera(terrain, [map.centerOffset[0] + (map.mapSize[0] * 128) / 2, map.centerOffset[1] + (map.mapSize[1] * 128) / 2], Math.max(map.mapSize[0], map.mapSize[1]) * 128 * 0.6);
  const { promise, resolve } = Promise.withResolvers<boolean>();
  root.querySelector<HTMLButtonElement>(".select")!.onclick = () => resolve(true);
  root.querySelector<HTMLButtonElement>(".back")!.onclick = () => resolve(false);
  let running = true;
  const step = () => {
    if (!running) return;
    requestAnimationFrame(step);
    viewer.updateAndRender();
  };
  step();
  const result = await promise;
  running = false;
  camera.dispose();
  root.hidden = true;
  return result;
}

/** Card grid of maps; a card opens the terrain view. Resolves with the selected map, a random one, or null on back. */
export async function selectMap(wc3: Wc3, maps: MapEntry[], root: HTMLElement, mapRoot: HTMLElement): Promise<MapEntry | null> {
  const grid = root.querySelector<HTMLElement>(".cards")!;
  for (;;) {
    const { promise, resolve } = Promise.withResolvers<MapEntry | null>();
    grid.replaceChildren(...maps.map((m) => {
      const card = document.createElement("button");
      card.className = "card";
      card.innerHTML = `<img alt=""><span class="name"></span><span class="meta"></span>`;
      if (m.preview) card.querySelector("img")!.src = m.preview;
      card.querySelector(".name")!.textContent = m.name;
      card.querySelector(".meta")!.textContent = `${m.players} players · ${m.size[0]}×${m.size[1]}`;
      card.onclick = () => resolve(m);
      return card;
    }));
    root.querySelector<HTMLButtonElement>(".back")!.onclick = () => resolve(null);
    root.querySelector<HTMLButtonElement>(".random")!.onclick = () => resolve({ ...maps[Math.floor(Math.random() * maps.length)], random: true });
    root.hidden = false;
    const map = await promise;
    root.hidden = true;
    if (!map) return null;
    if (map.random || (await viewMap(wc3, map.path, mapRoot))) return map;
  }
}
