// Main menu: the looping background video and logo shipped with the site, stone buttons, and the
// menu theme read from the install. `choose` reuses the button style for any list screen.

import type { Wc3 } from "./wc3";

export interface MenuItem { label: string; run: () => Promise<void>; disabled?: () => boolean }

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "stone";
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

export async function showMenu(wc3: Wc3, root: HTMLElement, subtitle: () => string, items: MenuItem[]): Promise<never> {
  const music = await wc3.url("Sound\\Music\\mp3Music\\mainscreen.mp3");
  root.innerHTML = `
    <video class="bg" src="assets/mainmenu.webm" autoplay loop muted playsinline></video>
    <img class="logo" src="assets/reforged-logo.png" alt="Warcraft III: Reforged">
    <nav></nav>
    <p class="selection"></p>
    <footer><span>${wc3.casc.version}</span></footer>`;
  const audio = new Audio(music);
  audio.loop = true;
  const nav = root.querySelector("nav")!;
  const selection = root.querySelector(".selection")!;
  for (;;) {
    selection.textContent = subtitle();
    root.hidden = false;
    audio.play().catch(() => {});
    const { promise, resolve } = Promise.withResolvers<MenuItem>();
    nav.replaceChildren(...items.map((item) => Object.assign(button(item.label, () => resolve(item)), { disabled: item.disabled?.() ?? false })));
    const item = await promise;
    root.hidden = true;
    audio.pause();
    await item.run();
  }
}

/** Shows a titled list of stone buttons; resolves with the chosen index, or -1 for back. */
export function choose(root: HTMLElement, title: string, labels: string[]): Promise<number> {
  const { promise, resolve } = Promise.withResolvers<number>();
  root.innerHTML = `<h1></h1><nav></nav>`;
  root.querySelector("h1")!.textContent = title;
  const nav = root.querySelector("nav")!;
  nav.replaceChildren(...labels.map((label, i) => button(label, () => resolve(i))), button("Back", () => resolve(-1)));
  root.hidden = false;
  return promise.finally(() => (root.hidden = true));
}
