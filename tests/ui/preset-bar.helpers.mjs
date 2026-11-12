// Driving the shared preset bar (`ui/app/105-preset-bar.js`) the way a person
// does: the name box, its list, the ⋯ menu and the asks. Every page's bar is
// `#<id>Pb`: `gs`, `gsCp`, `chop`, `wv`, `wvB`, `prism`, `vp`.

export const bar = (page, id) => page.locator(`#${id}Pb`);
export const pbName = (page, id) => bar(page, id).locator('[data-pb="label"]').textContent();
export const pbTag = (page, id) => bar(page, id).locator('[data-pb="tag"]').textContent();
/// Save is lit when the preset has been edited since it was loaded.
export const pbLit = (page, id) => bar(page, id).locator('[data-pb="save"]').evaluate((e) => e.classList.contains('lit'));

/// The pop-up open now: the list, the menu or an ask.
export const pop = (page) => page.locator('.pbar-pop');

export async function pbStep(page, id, by) {
  await bar(page, id).locator(`[data-pb="${by > 0 ? 'next' : 'prev'}"]`).click();
}

export async function pbOpenList(page, id) {
  await bar(page, id).locator('[data-pb="open"]').click();
  await pop(page).locator('.pbar-search input').waitFor();
}

/// Open the list and click the row with this name.
export async function pbPick(page, id, name) {
  await pbOpenList(page, id);
  await pop(page).locator(`.pbar-row[title="${name}"]`).first().click();
}

export async function pbMenu(page, id, item) {
  await bar(page, id).locator('[data-pb="more"]').click();
  await pop(page).locator(`[data-mi="${item}"]`).click();
}

/// Save as… (or Rename…), with the name typed into the ask.
export async function pbAsk(page, id, item, name) {
  await pbMenu(page, id, item);
  const field = pop(page).locator('.pbar-field');
  await field.fill(name);
  await field.press('Enter');
}
export const pbSaveAs = (page, id, name) => pbAsk(page, id, 'saveAs', name);
export const pbRename = (page, id, name) => pbAsk(page, id, 'rename', name);

/// Delete…, and yes when it asks.
export async function pbDelete(page, id) {
  await pbMenu(page, id, 'delete');
  await pop(page).locator('[data-a="ok"]').click();
}
