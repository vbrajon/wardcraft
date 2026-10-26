// Battle: two armies composed on a setup screen, spawned at the map's start locations, simulated
// by Sim and rendered on the terrain with the units' own models, animations and missiles.

import { quat } from "gl-matrix";
import type { MappedData } from "../vendor/mdx-m3-viewer/utils/mappeddata";
import War3MapUnitsDoo from "../vendor/mdx-m3-viewer/parsers/w3x/unitsdoo/file";
import War3MapWpm from "../vendor/mdx-m3-viewer/parsers/w3x/wpm/file";
import type MdxModel from "../vendor/mdx-m3-viewer/viewer/handlers/mdx/model";
import type MdxModelInstance from "../vendor/mdx-m3-viewer/viewer/handlers/mdx/modelinstance";
import { unitType, type Hero, type Misc, type UnitType } from "./data";
import { loadTerrain, rtsCamera } from "./maps";
import { Sim, TICK, type SimUnit } from "./sim";
import type { Wc3 } from "./wc3";

export interface Army { hero?: Hero; units: [id: string, count: number][] }

/** Standard melee rosters per race; the setup screen lets the counts be edited. */
export const PRESETS: Record<string, [string, number][]> = {
  Human: [["hfoo", 6], ["hrif", 4], ["hkni", 2], ["hmpr", 2], ["hsor", 0], ["hmtm", 0]],
  Orc: [["ogru", 6], ["ohun", 4], ["orai", 2], ["oshm", 2], ["odoc", 0], ["otau", 0]],
  Undead: [["ugho", 6], ["ucry", 4], ["uabo", 2], ["unec", 2], ["uban", 0], ["umtw", 0]],
  "Night Elf": [["earc", 6], ["esen", 4], ["edoc", 2], ["edry", 2], ["ebal", 0], ["emtg", 0]],
};
const RACE_ORDER = Object.keys(PRESETS);

/** Two columns: race, hero and unit counts per side. Resolves with both armies, or null on back. */
export function setupArmies(units: MappedData, roster: Hero[], root: HTMLElement, hero?: Hero): Promise<[Army, Army] | null> {
  const { promise, resolve } = Promise.withResolvers<[Army, Army] | null>();
  const armies: Army[] = [];
  const names = (id: string) => units.getRow(id)?.string("name") ?? id;
  const columns = root.querySelector<HTMLElement>(".sides")!;
  columns.replaceChildren();
  for (const side of [0, 1] as const) {
    const race = side === 0 ? hero?.race ?? "Human" : RACE_ORDER[(RACE_ORDER.indexOf(hero?.race ?? "Human") + 1) % RACE_ORDER.length];
    const army: Army = { hero: side === 0 ? hero : undefined, units: [] };
    armies.push(army);
    const col = document.createElement("div");
    col.className = `side panel side${side}`;
    col.innerHTML = `<h2>${side === 0 ? "Red" : "Blue"} army</h2><label>Race <select class="race"></select></label><label>Hero <select class="hero"></select></label><div class="units"></div>`;
    const raceSelect = col.querySelector<HTMLSelectElement>(".race")!;
    const heroSelect = col.querySelector<HTMLSelectElement>(".hero")!;
    const list = col.querySelector<HTMLElement>(".units")!;
    raceSelect.replaceChildren(...RACE_ORDER.map((r) => new Option(r, r, r === race, r === race)));
    const fill = () => {
      const r = raceSelect.value;
      const heroes = roster.filter((h) => h.race === r || h.race === "Neutral");
      heroSelect.replaceChildren(...heroes.map((h) => new Option(h.name, h.id, h === army.hero, h === army.hero)));
      if (!heroes.includes(army.hero!)) army.hero = heroes[0];
      heroSelect.value = army.hero!.id;
      army.units = PRESETS[r].map(([id, n]) => [id, n]);
      list.replaceChildren(...army.units.map((entry) => {
        const row = document.createElement("label");
        row.innerHTML = `<span></span><input type="number" min="0" max="30">`;
        row.querySelector("span")!.textContent = names(entry[0]);
        const input = row.querySelector("input")!;
        input.value = String(entry[1]);
        input.oninput = () => (entry[1] = Math.max(0, Math.min(30, Number(input.value) || 0)));
        return row;
      }));
    };
    raceSelect.onchange = fill;
    heroSelect.onchange = () => (army.hero = roster.find((h) => h.id === heroSelect.value));
    fill();
    columns.append(col);
  }
  root.querySelector<HTMLButtonElement>(".fight")!.onclick = () => resolve([armies[0], armies[1]]);
  root.querySelector<HTMLButtonElement>(".back")!.onclick = () => resolve(null);
  root.hidden = false;
  return promise.finally(() => (root.hidden = true));
}

interface Actor { instance: MdxModelInstance; model: MdxModel; anim: string }

const sequence = (model: MdxModel, name: RegExp) => model.sequences.findIndex((s) => name.test(s.name));

/** Runs one battle on the given map until a side wins or the user leaves. */
export async function runBattle(wc3: Wc3, units: MappedData, misc: Misc, mapPath: string, armies: [Army, Army], root: HTMLElement): Promise<void> {
  const canvas = root.querySelector("canvas")!;
  const hud = root.querySelector<HTMLElement>(".hud")!;
  const bars = root.querySelector<HTMLCanvasElement>(".bars")!;
  const terrain = await loadTerrain(wc3, canvas, mapPath);
  const { map, viewer } = terrain;
  const solver = (src: unknown) => (typeof src === "string" ? wc3.resolve(src) : src);

  const wpm = new War3MapWpm();
  wpm.load(map.map.get("war3map.wpm")!.bytes());
  const sim = new Sim(misc, { size: [wpm.size[0], wpm.size[1]], origin: [map.centerOffset[0], map.centerOffset[1]], cells: wpm.pathing }, Date.now() & 0xffff);

  const doo = new War3MapUnitsDoo();
  doo.load(map.map.get("war3mapUnits.doo")!.bytes(), map.buildVersion);
  const starts = doo.units.filter((u) => u.id === "sloc").map((u) => [u.location[0], u.location[1]] as [number, number]);
  const center: [number, number] = [map.centerOffset[0] + (map.mapSize[0] * 128) / 2, map.centerOffset[1] + (map.mapSize[1] * 128) / 2];
  const spawnAt: [number, number][] = starts.length >= 2 ? [starts[0], starts.reduce((far, s) => (Math.hypot(s[0] - starts[0][0], s[1] - starts[0][1]) > Math.hypot(far[0] - starts[0][0], far[1] - starts[0][1]) ? s : far), starts[1])] : [[center[0] - 900, center[1]], [center[0] + 900, center[1]]];

  const types = new Map<string, UnitType>();
  const typeOf = (id: string) => types.get(id) ?? types.set(id, unitType(units, misc, id)).get(id)!;
  for (const side of [0, 1] as const) {
    const army = armies[side];
    const [sx, sy] = spawnAt[side];
    const [ex, ey] = spawnAt[1 - side];
    const facing = Math.atan2(ey - sy, ex - sx);
    const ids = [...(army.hero ? [army.hero.id] : []), ...army.units.flatMap(([id, n]) => Array(n).fill(id) as string[])];
    const cols = Math.ceil(Math.sqrt(ids.length * 2));
    ids.forEach((id, i) => {
      // Rows across the facing direction, ranks behind; the hero stands in front.
      const col = i % cols - (cols - 1) / 2, row = Math.floor(i / cols);
      const dx = -Math.sin(facing) * col * 80 - Math.cos(facing) * row * 80, dy = Math.cos(facing) * col * 80 - Math.sin(facing) * row * 80;
      sim.spawn(typeOf(id), side, sx + dx, sy + dy, facing);
    });
  }

  hud.hidden = false;
  root.querySelector<HTMLElement>(".actions")!.hidden = true;
  root.hidden = false; // the camera measures the canvas, so the screen must be visible first
  const camera = rtsCamera(terrain, [(spawnAt[0][0] + spawnAt[1][0]) / 2, (spawnAt[0][1] + spawnAt[1][1]) / 2], 2000);
  const scene = map.worldScene;
  const corners = map.corners;
  const heightAt = (x: number, y: number) => {
    const fx = (x - map.centerOffset[0]) / 128, fy = (y - map.centerOffset[1]) / 128;
    const cx = Math.max(0, Math.min(map.mapSize[0] - 2, Math.floor(fx))), cy = Math.max(0, Math.min(map.mapSize[1] - 2, Math.floor(fy)));
    const h = (c: { groundHeight: number; layerHeight: number }) => (c.groundHeight + c.layerHeight - 2) * 128;
    const tx = fx - cx, ty = fy - cy;
    const bottom = h(corners[cy][cx]) * (1 - tx) + h(corners[cy][cx + 1]) * tx;
    const top = h(corners[cy + 1][cx]) * (1 - tx) + h(corners[cy + 1][cx + 1]) * tx;
    return bottom * (1 - ty) + top * ty;
  };

  const actors = new Map<number, Actor>();
  const missiles = new Map<number, Actor>();
  const models = new Map<string, Promise<MdxModel | undefined>>();
  const model = (path: string) => models.get(path) ?? models.set(path, viewer.load(path, solver) as Promise<MdxModel | undefined>).get(path)!;
  const rotation = quat.create();
  const screen = new Float32Array(3);

  /** Fills a store slot once its model arrives; the slot is reserved synchronously so a frame asks only once. */
  const actorFor = async (key: number, store: Map<number, Actor>, path: string, team: number, scale: number) => {
    store.set(key, { instance: null!, model: null!, anim: "" });
    const m = await model(path);
    const slot = store.get(key);
    if (!slot) return;
    if (!m) { store.delete(key); return; }
    const instance = m.addInstance() as MdxModelInstance;
    instance.setScene(scene);
    instance.setTeamColor(team);
    instance.setUniformScale(scale);
    slot.instance = instance;
    slot.model = m;
  };

  const play = (actor: Actor, anim: string, pattern: RegExp, loop: boolean) => {
    if (actor.anim === anim) return;
    actor.anim = anim;
    const matches = actor.model.sequences.map((s, i) => [s.name, i] as const).filter(([n]) => pattern.test(n));
    const pick = matches.length ? matches[Math.floor(Math.random() * matches.length)][1] : Math.max(0, sequence(actor.model, /^stand/i));
    actor.instance.setSequence(pick);
    actor.instance.setSequenceLoopMode(loop ? 2 : 1);
  };

  const syncUnit = (u: SimUnit) => {
    const actor = actors.get(u.id);
    if (!actor) { actorFor(u.id, actors, u.type.model, u.side, u.type.scale); return; }
    if (!actor.instance) return;
    actor.instance.setLocation([u.x, u.y, heightAt(u.x, u.y)]);
    actor.instance.setRotation(quat.setAxisAngle(rotation, [0, 0, 1], u.facing));
    if (u.state === "dead") play(actor, "death", /^death/i, false);
    else if (u.state === "attack") play(actor, `attack${u.swings}`, /^attack/i, false);
    else if (u.state === "move") play(actor, "walk", /^walk/i, true);
    else play(actor, "stand", /^stand(\s|$|\s-\s\d)/i, true);
  };

  const ctx = bars.getContext("2d")!;
  const drawBars = () => {
    bars.width = canvas.width;
    bars.height = canvas.height;
    ctx.clearRect(0, 0, bars.width, bars.height);
    for (const u of sim.units) {
      if (u.state === "dead") continue;
      scene.camera.worldToScreen(screen, [u.x, u.y, heightAt(u.x, u.y) + 140 * u.type.scale] as unknown as Float32Array, scene.viewport);
      const w = 34, h = 5, x = screen[0] - w / 2, y = bars.height - screen[1];
      ctx.fillStyle = "#000";
      ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = u.side === 0 ? "#e0312e" : "#2f6fe0";
      ctx.fillRect(x, y, (w * u.hp) / u.type.hp, h);
    }
  };

  const status = hud.querySelector<HTMLElement>(".status")!;
  const result = hud.querySelector<HTMLElement>(".result")!;
  result.hidden = true;
  let speed = 1;
  for (const b of hud.querySelectorAll<HTMLButtonElement>("[data-speed]")) b.onclick = () => (speed = Number(b.dataset.speed));

  const { promise, resolve } = Promise.withResolvers<void>();
  hud.querySelector<HTMLButtonElement>(".leave")!.onclick = () => resolve();

  let running = true, last = performance.now(), acc = 0;
  const frame = (now: number) => {
    if (!running) return;
    requestAnimationFrame(frame);
    acc += Math.min(0.25, (now - last) / 1000) * speed;
    last = now;
    while (acc >= TICK) {
      acc -= TICK;
      if (sim.winner() === undefined) sim.step();
    }
    for (const u of sim.units) syncUnit(u);
    for (const [id, actor] of actors) if (!sim.units.some((u) => u.id === id)) { actor.instance?.detach(); actors.delete(id); }
    for (const p of sim.projectiles) {
      const actor = missiles.get(p.id);
      if (!actor) actorFor(p.id, missiles, p.model, p.source.side, 1);
      else if (actor.instance) {
        actor.instance.setLocation([p.x, p.y, heightAt(p.x, p.y) + p.z]);
        actor.instance.setRotation(quat.setAxisAngle(rotation, [0, 0, 1], Math.atan2(p.target.y - p.y, p.target.x - p.x)));
        play(actor, "stand", /^stand/i, true);
      }
    }
    for (const [id, actor] of missiles) if (!sim.projectiles.some((p) => p.id === id)) { actor.instance?.detach(); missiles.delete(id); }
    const living = sim.alive();
    if (living.length) camera.follow(living.reduce((s, u) => s + u.x, 0) / living.length, living.reduce((s, u) => s + u.y, 0) / living.length);
    viewer.updateAndRender();
    drawBars();
    const a = sim.alive(0).length, b = sim.alive(1).length;
    status.textContent = `${Math.floor(sim.time / 60)}:${String(Math.floor(sim.time % 60)).padStart(2, "0")} · Red ${a} · Blue ${b}`;
    const winner = sim.winner();
    if (winner !== undefined && result.hidden) {
      result.hidden = false;
      result.textContent = winner === "draw" ? "Draw — nobody can reach the enemy" : `${winner === 0 ? "Red" : "Blue"} army wins`;
    }
  };
  requestAnimationFrame(frame);
  await promise;
  running = false;
  for (const actor of [...actors.values(), ...missiles.values()]) actor.instance?.detach();
  camera.dispose();
  ctx.clearRect(0, 0, bars.width, bars.height);
  hud.hidden = true;
  root.hidden = true;
}
