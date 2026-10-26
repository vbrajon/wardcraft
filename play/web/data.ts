// Game data from the install's SLK and TXT tables: one merged row per unit id (balance, weapons,
// UI, skin, localized strings), the melee hero roster derived from it, and the campaign index.

import { MappedData, type MappedDataRow } from "../vendor/mdx-m3-viewer/utils/mappeddata";
import type { Wc3 } from "./wc3";

const UNIT_SLKS = ["Units\\UnitData.slk", "Units\\UnitBalance.slk", "Units\\UnitWeapons.slk", "Units\\UnitAbilities.slk", "Units\\UnitUI.slk"];
const UNIT_TXTS = ["Units\\UnitSkin.txt", ...["Human", "Orc", "Undead", "NightElf", "Neutral"].flatMap((r) => [`Units\\${r}UnitFunc.txt`, `Units\\${r}UnitStrings.txt`])];

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/**
 * Loads a table, then the melee balance container's override of it when one exists. Overrides replace
 * fields, except the roster lists: melee_v0's *UnitFunc.txt are Reign of Chaos fragments whose
 * `Trains` (altars) and `Sellunits` (taverns) omit the expansion heroes, so those are unioned.
 */
async function loadTable(wc3: Wc3, into: MappedData, path: string): Promise<void> {
  into.load(text(await wc3.read(path)));
  const override = `war3.w3mod:_balance/melee_v0.w3mod:${path.toLowerCase().replace(/\\/g, "/")}`;
  if (!wc3.casc.files.has(override)) return;
  const patch = new MappedData(text(await wc3.casc.read(override)));
  for (const [id, row] of Object.entries(patch.map)) {
    const base = into.getRow(id) ?? (into.setRow(id, row), undefined);
    if (!base) continue;
    for (const [key, value] of Object.entries(row.map)) {
      if (value === undefined) continue; // SLK rows omit trailing empty cells
      const old = base.string(key);
      base.set(key, (key === "trains" || key === "sellunits") && old ? [...new Set(`${old},${value}`.split(","))].join(",") : value);
    }
  }
}

/** Skin fields may be tiered (file:sd, file:hd); the SD tier is what this app renders. */
const skin = (row: MappedDataRow, key: string) => row.string(`${key}:sd`) ?? row.string(key) ?? "";

export const ATTACK_TYPES = ["normal", "pierce", "siege", "magic", "chaos", "spells", "hero"] as const;
export const ARMOR_TYPES = ["small", "medium", "large", "fort", "normal", "hero", "divine", "none"] as const;
export type AttackType = (typeof ATTACK_TYPES)[number];
export type ArmorType = (typeof ARMOR_TYPES)[number];

/** Combat constants from Units\MiscGame.txt [Misc]: hero stat scaling, armor curve, attack-vs-armor table. */
export interface Misc {
  strHp: number;
  intMana: number;
  agiArmor: number;
  agiArmorBase: number;
  armorFactor: number;
  bonus: Record<AttackType, Record<ArmorType, number>>;
}

export async function loadMisc(wc3: Wc3): Promise<Misc> {
  const table = new MappedData();
  await loadTable(wc3, table, "Units\\MiscGame.txt");
  const misc = table.getRow("Misc")!;
  const bonus = {} as Misc["bonus"];
  for (const attack of ATTACK_TYPES) {
    const row = misc.string(`DamageBonus${attack[0].toUpperCase()}${attack.slice(1)}`)!.split(",").map(Number);
    bonus[attack] = Object.fromEntries(ARMOR_TYPES.map((armor, i) => [armor, row[i]])) as Record<ArmorType, number>;
  }
  return {
    strHp: misc.number("StrHitPointBonus"),
    intMana: misc.number("IntManaBonus"),
    agiArmor: misc.number("AgiDefenseBonus"),
    agiArmorBase: misc.number("AgiDefenseBase"),
    armorFactor: misc.number("DefenseArmor"),
    bonus,
  };
}

export interface Attack {
  range: number;
  type: AttackType;
  weapon: string;
  cooldown: number;
  dice: number;
  sides: number;
  plus: number;
  point: number;
  backswing: number;
  missile?: { model: string; speed: number };
}

/** Everything the battle needs to know about a unit id, at level 1 with no upgrades. */
export interface UnitType {
  id: string;
  name: string;
  model: string;
  scale: number;
  hp: number;
  regen: number;
  armor: number;
  armorType: ArmorType;
  speed: number;
  collision: number;
  acquire: number;
  attack?: Attack;
}

export function unitType(units: MappedData, misc: Misc, id: string): UnitType {
  const row = units.getRow(id);
  if (!row) throw new Error(`unit ${id} not in the data`);
  const primary = row.string("primary");
  const hero = primary === "STR" || primary === "AGI" || primary === "INT";
  const str = hero ? row.number("str") : 0, agi = hero ? row.number("agi") : 0;
  const stat = hero ? { STR: str, AGI: agi, INT: row.number("int") }[primary!] : 0;
  const type: UnitType = {
    id,
    name: row.string("name") ?? id,
    model: `${skin(row, "file")}.mdx`,
    scale: Number(row.string("modelscale:sd") ?? row.string("modelscale") ?? 1), // `scale` is the selection circle, not the model
    hp: row.number("hp") + str * misc.strHp,
    regen: row.number("regenhp"),
    armor: row.number("def") + (hero ? agi * misc.agiArmor + misc.agiArmorBase : 0),
    armorType: (row.string("deftype") ?? "normal") as ArmorType,
    speed: row.number("spd"),
    collision: row.number("collision"),
    acquire: row.number("acquire"),
  };
  if ((row.number("weapson") & 1) && row.string("atktype1") !== "none") {
    const weapon = row.string("weaptp1") ?? "normal";
    const missile = (row.string("missileart") ?? "").split(",")[0];
    type.attack = {
      range: row.number("rangen1"),
      type: row.string("atktype1") as AttackType,
      weapon,
      cooldown: row.number("cool1"),
      dice: row.number("dice1"),
      sides: row.number("sides1"),
      plus: row.number("dmgplus1") + stat,
      point: row.number("dmgpt1"),
      backswing: row.number("backsw1"),
      // Melee and instant hits land at the damage point; everything else flies a missile model.
      missile: missile && weapon !== "normal" && weapon !== "instant" ? { model: missile.replace(/\.mdl$/i, ".mdx"), speed: row.number("missilespeed") || 1200 } : undefined,
    };
  }
  return type;
}

/** All unit rows: base SLKs, then skins, functions and strings, each with its melee override applied. */
export async function loadUnits(wc3: Wc3): Promise<MappedData> {
  const units = new MappedData();
  for (const path of [...UNIT_SLKS, ...UNIT_TXTS]) await loadTable(wc3, units, path);
  return units;
}

/** Ability rows: enough for names and icons of hero abilities. */
export async function loadAbilities(wc3: Wc3): Promise<MappedData> {
  const abilities = new MappedData(text(await wc3.read("Units\\AbilityData.slk")));
  for (const r of ["Human", "Orc", "Undead", "NightElf", "Neutral", "Common"]) abilities.load(text(await wc3.read(`Units\\${r}AbilityStrings.txt`)));
  return abilities;
}

export interface Hero {
  id: string;
  name: string;
  race: string;
  model: string;
  icon: string;
  primary: string;
  str: number;
  agi: number;
  int: number;
  hp: number;
  mana: number;
  armor: number;
  damage: [number, number];
  range: number;
  abilities: string[];
  row: MappedDataRow;
}

export const RACES: Record<string, string> = { human: "Human", orc: "Orc", undead: "Undead", nightelf: "Night Elf", creeps: "Neutral", demon: "Neutral", naga: "Neutral", other: "Neutral" };

/** Melee heroes: every unit with a primary attribute that an altar trains or the tavern sells. */
export function heroes(units: MappedData, misc: Misc): Hero[] {
  const trained = new Set<string>();
  for (const row of Object.values(units.map)) {
    for (const key of ["trains", "sellunits"]) for (const id of (row.string(key) ?? "").split(",")) trained.add(id.trim());
  }
  const list: Hero[] = [];
  for (const [id, row] of Object.entries(units.map)) {
    const primary = row.string("primary");
    if (!primary || !["STR", "AGI", "INT"].includes(primary) || !trained.has(id)) continue;
    const stat = { STR: row.number("str"), AGI: row.number("agi"), INT: row.number("int") }[primary] ?? 0;
    const dice = row.number("dice1"), sides = row.number("sides1"), plus = row.number("dmgplus1") + stat;
    list.push({
      id,
      name: row.string("name") ?? id,
      race: RACES[row.string("race") ?? "other"] ?? "Neutral",
      model: `${skin(row, "file")}.mdx`,
      icon: skin(row, "art"),
      primary,
      str: row.number("str"),
      agi: row.number("agi"),
      int: row.number("int"),
      hp: row.number("hp") + row.number("str") * misc.strHp,
      mana: row.number("manan") + row.number("int") * misc.intMana,
      armor: row.number("def") + row.number("agi") * misc.agiArmor + misc.agiArmorBase,
      damage: [plus + dice, plus + dice * sides],
      range: row.number("rangen1"),
      abilities: (row.string("heroabillist") ?? "").split(",").filter(Boolean),
      row,
    });
  }
  const order = ["Human", "Orc", "Undead", "Night Elf", "Neutral"];
  return list.sort((a, b) => order.indexOf(a.race) - order.indexOf(b.race) || (a.row.string("sortui") ?? "").localeCompare(b.row.string("sortui") ?? ""));
}

export interface Mission { header: string; name: string; map: string }
export interface Campaign { id: string; header: string; name: string; expansion: string; missions: Mission[] }

/** Campaign index from ui/CampaignInfoReforged.txt, with labels resolved through globalstrings.fdf. */
export async function loadCampaigns(wc3: Wc3): Promise<Campaign[]> {
  const strings = new Map<string, string>();
  for (const m of text(await wc3.read("UI\\FrameDef\\GlobalStrings.fdf")).matchAll(/^\s*([A-Z0-9_]+)\s+"((?:[^"\\]|\\.)*)"/gm)) strings.set(m[1], m[2]);
  const label = (key: string) => strings.get(key) ?? key;
  const info = new MappedData(text(await wc3.read("UI\\CampaignInfoReforged.txt")));
  const triple = (value: string) => value.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
  const campaigns: Campaign[] = [];
  for (const id of triple(info.getProperty("Index", "campaignlist"))) {
    const row = info.getRow(id);
    if (!row) continue;
    const missions: Mission[] = [];
    for (let i = 0; row.string(`mission${i}`); i++) {
      const [header, name, map] = triple(row.string(`mission${i}`)!);
      missions.push({ header: label(header), name: label(name), map });
    }
    campaigns.push({ id, header: label(row.string("header")!.replace(/"/g, "")), name: label(row.string("name")!.replace(/"/g, "")), expansion: row.string("expansion")!.replace(/"/g, ""), missions });
  }
  return campaigns;
}
