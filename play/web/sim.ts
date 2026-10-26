// Deterministic autobattle on Warcraft III numbers. Fixed 20 Hz tick, seeded dice, two sides.
// Units acquire the nearest enemy in range, otherwise march along a flow field over the map's
// pathing grid toward the enemy army. Damage = (plus + dice) × attack-vs-armor × armor curve.

import type { Misc, UnitType } from "./data";

export const TICK = 0.05;
const CELL = 32; // pathing grid cell in world units
const NO_WALK = 0x02;
const CORPSE_SECONDS = 6;
/** A battle with no damage for this long is a draw: nobody can reach anybody. */
const STALL_SECONDS = 60;

export interface SimUnit {
  id: number;
  type: UnitType;
  side: 0 | 1;
  x: number;
  y: number;
  facing: number;
  hp: number;
  state: "idle" | "move" | "attack" | "dead";
  target?: SimUnit;
  readyAt: number;
  busyUntil: number;
  swing?: { at: number; target: SimUnit };
  diedAt: number;
  /** Increments whenever a new attack animation must start. */
  swings: number;
}

export interface Projectile {
  id: number;
  model: string;
  x: number;
  y: number;
  z: number;
  speed: number;
  source: SimUnit;
  target: SimUnit;
  amount: number;
  alive: boolean;
}

export interface Pathing { size: [number, number]; origin: [number, number]; cells: Uint8Array }

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Sim {
  readonly units: SimUnit[] = [];
  readonly projectiles: Projectile[] = [];
  time = 0;
  private lastDamageAt = 0;
  private nextId = 1;
  private random: () => number;
  private flow: [Int32Array, Int32Array];
  private flowAt = -1;

  constructor(private misc: Misc, private pathing: Pathing, seed = 1) {
    this.random = mulberry32(seed);
    const n = pathing.size[0] * pathing.size[1];
    this.flow = [new Int32Array(n), new Int32Array(n)];
  }

  /** Spawns on the nearest walkable cell to (x, y), so formations never start inside trees or cliffs. */
  spawn(type: UnitType, side: 0 | 1, x: number, y: number, facing: number): SimUnit {
    [x, y] = this.nearestWalkable(x, y);
    const unit: SimUnit = { id: this.nextId++, type, side, x, y, facing, hp: type.hp, state: "idle", readyAt: 0, busyUntil: 0, diedAt: 0, swings: 0 };
    this.units.push(unit);
    return unit;
  }

  private nearestWalkable(x: number, y: number): [number, number] {
    if (this.walkable(x, y)) return [x, y];
    for (let r = CELL; r < CELL * 40; r += CELL) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (this.walkable(px, py)) return [px, py];
      }
    }
    return [x, y];
  }

  alive(side?: 0 | 1): SimUnit[] {
    return this.units.filter((u) => u.state !== "dead" && (side === undefined || u.side === side));
  }

  /** 0 or 1 once a side is wiped out, "draw" after a long stall, undefined while fighting. */
  winner(): 0 | 1 | "draw" | undefined {
    const a = this.alive(0).length, b = this.alive(1).length;
    if (!a || !b) return a ? 0 : 1;
    return this.time - this.lastDamageAt > STALL_SECONDS ? "draw" : undefined;
  }

  walkable(x: number, y: number): boolean {
    const [w, h] = this.pathing.size;
    const cx = Math.floor((x - this.pathing.origin[0]) / CELL), cy = Math.floor((y - this.pathing.origin[1]) / CELL);
    return cx >= 0 && cy >= 0 && cx < w && cy < h && !(this.pathing.cells[cy * w + cx] & NO_WALK);
  }

  step(): void {
    const dt = TICK;
    this.time += dt;
    if (this.time - this.flowAt >= 0.5) this.updateFlow();

    for (const u of this.units) {
      if (u.state === "dead") continue;
      if (u.swing && this.time >= u.swing.at) this.land(u);
      if (u.target && (u.target.state === "dead" || this.distance(u, u.target) > u.type.acquire * 2)) u.target = undefined;
      if (!u.target) u.target = this.nearestEnemy(u, u.type.acquire);
      if (this.time < u.busyUntil) continue;
      const attack = u.type.attack;
      if (u.target && attack && this.distance(u, u.target) - u.type.collision - u.target.type.collision <= attack.range) {
        u.facing = Math.atan2(u.target.y - u.y, u.target.x - u.x);
        if (this.time >= u.readyAt) {
          u.state = "attack";
          u.swings++;
          u.swing = { at: this.time + attack.point, target: u.target };
          u.readyAt = this.time + attack.cooldown;
          u.busyUntil = this.time + attack.point + attack.backswing;
        } else if (u.state !== "attack") {
          u.state = "idle";
        }
        continue;
      }
      this.move(u, dt);
    }

    for (const p of this.projectiles) {
      if (!p.alive) continue;
      const dx = p.target.x - p.x, dy = p.target.y - p.y;
      const d = Math.hypot(dx, dy);
      const stepLen = p.speed * dt;
      if (d <= stepLen || p.target.state === "dead") {
        p.x = p.target.x;
        p.y = p.target.y;
        p.alive = false;
        if (p.target.state !== "dead") this.damage(p.source, p.target, p.amount);
      } else {
        p.x += (dx / d) * stepLen;
        p.y += (dy / d) * stepLen;
      }
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) if (!this.projectiles[i].alive) this.projectiles.splice(i, 1);
    for (let i = this.units.length - 1; i >= 0; i--) if (this.units[i].state === "dead" && this.time - this.units[i].diedAt > CORPSE_SECONDS) this.units.splice(i, 1);
  }

  private distance(a: SimUnit, b: SimUnit): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private nearestEnemy(u: SimUnit, within: number): SimUnit | undefined {
    let best: SimUnit | undefined, bestD = within;
    for (const e of this.units) {
      if (e.side === u.side || e.state === "dead") continue;
      const d = this.distance(u, e);
      if (d <= bestD) { best = e; bestD = d; }
    }
    return best;
  }

  private roll(u: SimUnit): number {
    const a = u.type.attack!;
    let amount = a.plus;
    for (let i = 0; i < a.dice; i++) amount += 1 + Math.floor(this.random() * a.sides);
    return amount;
  }

  private land(u: SimUnit): void {
    const { target } = u.swing!;
    u.swing = undefined;
    if (target.state === "dead") return;
    const attack = u.type.attack!;
    if (attack.missile) {
      this.projectiles.push({ id: this.nextId++, model: attack.missile.model, x: u.x, y: u.y, z: 60, speed: attack.missile.speed, source: u, target, amount: this.roll(u), alive: true });
    } else {
      this.damage(u, target, this.roll(u));
    }
  }

  private damage(source: SimUnit, target: SimUnit, amount: number): void {
    const attack = source.type.attack!;
    const a = target.type.armor * this.misc.armorFactor;
    const armor = target.type.armor >= 0 ? 1 - a / (1 + a) : 2 - Math.pow(1 - this.misc.armorFactor, -target.type.armor);
    target.hp -= amount * this.misc.bonus[attack.type][target.type.armorType] * armor;
    this.lastDamageAt = this.time;
    if (target.hp <= 0) {
      target.hp = 0;
      target.state = "dead";
      target.diedAt = this.time;
      target.swing = undefined;
      target.target = undefined;
    }
  }

  private move(u: SimUnit, dt: number): void {
    let dx: number, dy: number;
    if (u.target) {
      dx = u.target.x - u.x;
      dy = u.target.y - u.y;
    } else {
      [dx, dy] = this.flowDirection(u);
      if (!dx && !dy) {
        // Off the flow field (unreachable pocket): head straight for the nearest enemy anyway.
        const enemy = this.nearestEnemy(u, Infinity);
        if (!enemy) { u.state = "idle"; return; }
        dx = enemy.x - u.x;
        dy = enemy.y - u.y;
      }
    }
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // Keep bodies apart: push away from any overlapping living unit.
    for (const o of this.units) {
      if (o === u || o.state === "dead") continue;
      const ox = u.x - o.x, oy = u.y - o.y;
      const d = Math.hypot(ox, oy);
      const min = u.type.collision + o.type.collision;
      if (d > 0 && d < min) {
        dx += (ox / d) * ((min - d) / min) * 1.5;
        dy += (oy / d) * ((min - d) / min) * 1.5;
      }
    }
    const l2 = Math.hypot(dx, dy) || 1;
    const stepLen = u.type.speed * dt;
    const nx = u.x + (dx / l2) * stepLen, ny = u.y + (dy / l2) * stepLen;
    // A unit already standing somewhere unwalkable (pushed there) may always move out.
    const stuck = !this.walkable(u.x, u.y);
    if (stuck || this.walkable(nx, ny)) { u.x = nx; u.y = ny; }
    else if (this.walkable(nx, u.y)) u.x = nx;
    else if (this.walkable(u.x, ny)) u.y = ny;
    else { u.state = "idle"; return; }
    u.facing = Math.atan2(dy, dx);
    u.state = "move";
  }

  /** Breadth-first distances from each side's living centroid, so the other side can march toward it. */
  private updateFlow(): void {
    this.flowAt = this.time;
    const [w, h] = this.pathing.size;
    for (const side of [0, 1] as const) {
      const enemies = this.alive(side === 0 ? 1 : 0);
      const dist = this.flow[side].fill(-1);
      if (!enemies.length) continue;
      const cx = enemies.reduce((s, e) => s + e.x, 0) / enemies.length, cy = enemies.reduce((s, e) => s + e.y, 0) / enemies.length;
      const start = this.cellOf(cx, cy);
      if (start < 0) continue;
      const queue = new Int32Array(w * h);
      let head = 0, tail = 0;
      dist[start] = 0;
      queue[tail++] = start;
      while (head < tail) {
        const c = queue[head++];
        const x = c % w, y = (c - x) / w, d = dist[c] + 1;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (dist[n] >= 0 || this.pathing.cells[n] & NO_WALK) continue;
          dist[n] = d;
          queue[tail++] = n;
        }
      }
    }
  }

  private cellOf(x: number, y: number): number {
    const [w, h] = this.pathing.size;
    const cx = Math.floor((x - this.pathing.origin[0]) / CELL), cy = Math.floor((y - this.pathing.origin[1]) / CELL);
    return cx >= 0 && cy >= 0 && cx < w && cy < h ? cy * w + cx : -1;
  }

  private flowDirection(u: SimUnit): [number, number] {
    const dist = this.flow[u.side];
    const [w, h] = this.pathing.size;
    const c = this.cellOf(u.x, u.y);
    if (c < 0 || dist[c] < 0) return [0, 0];
    const x = c % w, y = (c - x) / w;
    let best = dist[c], bx = 0, by = 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const d = dist[ny * w + nx];
        if (d >= 0 && d < best) { best = d; bx = ox; by = oy; }
      }
    }
    return [bx, by];
  }
}
