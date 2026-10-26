// Hero selection: race tabs, icon grid, the hero's own model standing in the viewer, and the
// stats the game would show at level 1. Resolves with the chosen hero, or null on back.

import type { MappedData } from "../vendor/mdx-m3-viewer/utils/mappeddata";
import type { Hero } from "./data";
import type { View } from "./view";
import type { Wc3 } from "./wc3";

export async function selectHero(wc3: Wc3, view: View, heroes: Hero[], abilities: MappedData, root: HTMLElement): Promise<Hero | null> {
  const { promise, resolve } = Promise.withResolvers<Hero | null>();
  // The canvas stays; only the overlay is rebuilt.
  root.querySelector(".ui")!.innerHTML = `
    <aside class="roster panel"><div class="tabs"></div><div class="grid"></div></aside>
    <aside class="stats panel"></aside>
    <div class="actions"><button class="stone select">Select</button><button class="stone back">Back</button></div>`;
  const tabs = root.querySelector<HTMLElement>(".tabs")!;
  const grid = root.querySelector<HTMLElement>(".grid")!;
  const stats = root.querySelector<HTMLElement>(".stats")!;
  const races = [...new Set(heroes.map((h) => h.race))];
  let current: Hero | undefined;
  let race = races[0];

  const showStats = (h: Hero) => {
    const abilityNames = h.abilities.map((id) => abilities.getRow(id)?.string("name") ?? id);
    stats.innerHTML = `
      <h2></h2><div class="primary"></div>
      <dl>
        <dt>Strength</dt><dd>${h.str}</dd><dt>Agility</dt><dd>${h.agi}</dd><dt>Intelligence</dt><dd>${h.int}</dd>
        <dt>Hit points</dt><dd>${h.hp}</dd><dt>Mana</dt><dd>${h.mana}</dd><dt>Armor</dt><dd>${h.armor.toFixed(1)}</dd>
        <dt>Damage</dt><dd>${h.damage[0]}–${h.damage[1]}</dd><dt>Range</dt><dd>${h.range}</dd>
      </dl>
      <ul></ul>`;
    stats.querySelector("h2")!.textContent = h.name;
    stats.querySelector(".primary")!.textContent = `${h.race} · ${{ STR: "Strength", AGI: "Agility", INT: "Intelligence" }[h.primary]} hero`;
    stats.querySelector("ul")!.replaceChildren(...abilityNames.map((n) => Object.assign(document.createElement("li"), { textContent: n })));
  };

  const pick = async (h: Hero) => {
    current = h;
    for (const b of grid.children) b.classList.toggle("active", b.getAttribute("data-id") === h.id);
    showStats(h);
    const model = await view.model(h.model);
    if (!model || current !== h) return;
    view.clear();
    view.stand(model, 0);
    view.fit(model);
  };

  const showRace = (r: string) => {
    race = r;
    for (const b of tabs.children) b.classList.toggle("active", b.textContent === r);
    const list = heroes.filter((h) => h.race === r);
    grid.replaceChildren(...list.map((h) => {
      const b = document.createElement("button");
      b.className = "icon";
      b.setAttribute("data-id", h.id);
      b.title = h.name;
      wc3.image(h.icon).then((src) => (b.style.backgroundImage = `url(${src})`));
      b.onclick = () => pick(h);
      return b;
    }));
    pick(list[0]);
  };

  tabs.replaceChildren(...races.map((r) => Object.assign(document.createElement("button"), { className: "tab", textContent: r, onclick: () => showRace(r) })));
  root.querySelector<HTMLButtonElement>(".select")!.onclick = () => resolve(current ?? null);
  root.querySelector<HTMLButtonElement>(".back")!.onclick = () => resolve(null);

  root.hidden = false;
  view.start();
  showRace(race);
  const result = await promise;
  view.stop();
  view.clear();
  root.hidden = true;
  return result;
}
