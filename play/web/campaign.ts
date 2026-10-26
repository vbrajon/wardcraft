// Campaign selection: the Reforged book spines, then a campaign's key art and chapter list.
// Resolves with the chosen mission, or null on back.

import type { Campaign, Mission } from "./data";
import type { Wc3 } from "./wc3";

const ART: Record<string, [spine: string, keyart: string]> = {
  Tutorial: ["roc_prologue", "prologue"],
  Human: ["roc_human", "human"],
  Undead: ["roc_undead", "undead"],
  Orc: ["roc_orc", "orc"],
  NightElf: ["roc_nightelf", "nightelf"],
  NightElfEx: ["tft_sentinels", "sentinel"],
  HumanEx: ["tft_alliance", "alliance"],
  UndeadEx: ["tft_scourge", "scourge"],
  OrcEx: ["tft_bonus", "rexxar"],
};
const BACKGROUNDS = "WebUI\\campaign\\campaignselect\\backgrounds\\";

export async function selectMission(wc3: Wc3, campaigns: Campaign[], root: HTMLElement): Promise<Mission | null> {
  const { promise, resolve } = Promise.withResolvers<Mission | null>();
  root.innerHTML = `
    <div class="spines"></div>
    <aside class="chapters panel"><img class="keyart" alt=""><h2></h2><h3></h3><ol></ol></aside>
    <div class="actions"><button class="stone back">Back</button></div>`;
  const spines = root.querySelector<HTMLElement>(".spines")!;
  const chapters = root.querySelector<HTMLElement>(".chapters")!;

  const show = async (c: Campaign) => {
    for (const s of spines.children) s.classList.toggle("active", s.getAttribute("data-id") === c.id);
    chapters.querySelector("h2")!.textContent = c.header;
    chapters.querySelector("h3")!.textContent = c.name;
    chapters.querySelector("ol")!.replaceChildren(...c.missions.map((m) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="chapter"></span><span class="mission"></span>`;
      li.querySelector(".chapter")!.textContent = m.header;
      li.querySelector(".mission")!.textContent = m.name;
      li.onclick = () => resolve(m);
      return li;
    }));
    chapters.querySelector<HTMLImageElement>(".keyart")!.src = await wc3.url(`${BACKGROUNDS}wc3_campaign_keyart_${ART[c.id][1]}.png`);
    chapters.hidden = false;
  };

  spines.replaceChildren(...campaigns.map((c) => {
    const img = document.createElement("img");
    img.className = "spine";
    img.setAttribute("data-id", c.id);
    img.alt = c.header;
    img.title = c.name;
    wc3.url(`${BACKGROUNDS}${ART[c.id][0]}_spine.png`).then((src) => (img.src = src));
    img.onclick = () => show(c);
    return img;
  }));
  chapters.hidden = true;
  root.querySelector<HTMLButtonElement>(".back")!.onclick = () => resolve(null);

  root.hidden = false;
  const result = await promise;
  root.hidden = true;
  return result;
}
