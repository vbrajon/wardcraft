import { Casc, type Source } from "../casc/casc";
import { runBattle, setupArmies, type Army } from "./battle";
import { selectMission } from "./campaign";
import { heroes, loadAbilities, loadCampaigns, loadMisc, loadUnits } from "./data";
import { selectHero } from "./heroes";
import { listMaps, selectMap, viewMap, type MapEntry } from "./maps";
import { choose, showMenu } from "./menu";
import { playMovie } from "./movie";
import { listSource } from "./source";
import { View } from "./view";
import { Wc3 } from "./wc3";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const CINEMATICS: [string, string][] = [
  ["blizzardlogo", "Blizzard logo"],
  ["war3logo", "Warcraft III logo"],
  ["introre", "Intro — Reforged"],
  ["introx", "Intro — The Frozen Throne"],
  ["tutorialop", "Prologue — Opening"],
  ["tutorialin", "Prologue — Interlude"],
  ["humanop", "Human — Opening"],
  ["humaned", "Human — Ending"],
  ["undeaded", "Undead — Ending"],
  ["orced", "Orc — Ending"],
  ["nightelfed", "Night Elf — Ending"],
  ["arthasillidanfight", "Arthas vs Illidan"],
  ["outrox", "Ending — The Frozen Throne"],
  ["outrore", "Ending — Reforged"],
  ["promore", "Reforged trailer"],
];

async function playMovies(wc3: Wc3, names: string[]): Promise<void> {
  const canvas = $<HTMLCanvasElement>("#movie");
  canvas.hidden = false;
  for (const name of names) {
    const skip = new AbortController();
    const onSkip = () => skip.abort();
    // Next task: the click that chose this movie is still bubbling and must not skip it.
    await new Promise((r) => setTimeout(r));
    addEventListener("click", onSkip);
    addEventListener("keydown", onSkip);
    try {
      await playMovie(wc3, name, canvas, skip.signal);
    } catch (e) {
      console.warn(`${name}: ${(e as Error).message}`); // one broken movie must not take the app down
    } finally {
      removeEventListener("click", onSkip);
      removeEventListener("keydown", onSkip);
    }
  }
  canvas.hidden = true;
}

async function start(source: Source): Promise<void> {
  $("#setup").hidden = true;
  const loading = $("#loading");
  const bar = $<HTMLProgressElement>("#loading progress");
  loading.hidden = false;
  const casc = await Casc.open(source, (done, total) => {
    bar.max = total;
    bar.value = done;
  });
  const wc3 = new Wc3(casc);
  const [units, misc, campaigns] = await Promise.all([loadUnits(wc3), loadMisc(wc3), loadCampaigns(wc3)]);
  const roster = heroes(units, misc);
  const abilities = await loadAbilities(wc3);
  const view = new View(wc3, $<HTMLCanvasElement>("#heroes canvas"));
  loading.hidden = true;

  // Fullscreen needs a click: the first one, which skips the logo. Once; Esc is respected after.
  addEventListener("click", () => document.documentElement.requestFullscreen(), { once: true });
  const intro = localStorage.getItem("introSeen") ? [] : ["introre"];
  await playMovies(wc3, ["blizzardlogo", "war3logo", ...intro]);
  localStorage.setItem("introSeen", "1");

  const screen = $("#screen");
  let maps: MapEntry[] | undefined;
  let last: { armies: [Army, Army]; map: MapEntry } | undefined;
  const battle = async (armies: [Army, Army], map: MapEntry) => {
    last = { armies, map };
    await runBattle(wc3, units, misc, map.path, armies, $("#map"));
  };
  const subtitle = () => (last ? `${last.armies[0].hero?.name ?? "Red"} vs ${last.armies[1].hero?.name ?? "Blue"} · ${last.map.name}` : "");
  const options = [
    { label: "Campaign", run: async () => { const mission = await selectMission(wc3, campaigns, $("#campaign")); if (mission) await viewMap(wc3, mission.map, $("#map")); } },
    { label: "Maps", run: async () => { maps ??= await listMaps(wc3); await selectMap(wc3, maps, $("#maps"), $("#map")); } },
    { label: "Heroes", run: async () => { await selectHero(wc3, view, roster, abilities, $("#heroes")); } },
    { label: "Cinematics", run: async () => { for (;;) { const i = await choose(screen, "Cinematics", CINEMATICS.map(([, title]) => title)); if (i < 0) return; await playMovies(wc3, [CINEMATICS[i][0]]); } } },
    { label: "Change folder", run: async () => location.reload() },
  ];
  await showMenu(wc3, $("#menu"), subtitle, [
    {
      label: "Play",
      run: async () => {
        const armies = await setupArmies(units, roster, $("#armies"), last?.armies[0].hero);
        if (!armies) return;
        maps ??= await listMaps(wc3);
        const map = await selectMap(wc3, maps, $("#maps"), $("#map"));
        if (map) await battle(armies, map);
      },
    },
    {
      label: "Options",
      run: async () => {
        for (;;) {
          const i = await choose(screen, "Options", options.map((o) => o.label));
          if (i < 0) return;
          await options[i].run();
        }
      },
    },
    { label: "Replay", disabled: () => !last, run: () => battle(last!.armies, last!.map) },
  ]);
}

function fail(e: Error): void {
  console.error(e);
  $("#loading").hidden = true;
  $("#setup").hidden = false;
  $("#error").textContent = e.message;
}

// <input webkitdirectory>, not showDirectoryPicker: Chrome refuses directory handles under
// /Applications and Program Files, where Battle.net installs, so nothing can be remembered.
function boot(): void {
  const input = $<HTMLInputElement>("#folder");
  $<HTMLButtonElement>("#pick").onclick = () => input.click();
  input.onchange = () => {
    const files = input.files;
    if (!files?.length) return;
    if (![...files].some((f) => f.webkitRelativePath.split("/").slice(1).join("/") === ".build.info")) {
      input.value = "";
      fail(new Error("That folder has no .build.info. Pick the Warcraft III install folder."));
      return;
    }
    start(listSource(files)).catch(fail);
  };
  $("#setup").hidden = false;
}

boot();
