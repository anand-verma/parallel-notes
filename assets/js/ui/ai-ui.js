export function populateModels(select, models, selected, credentialReady) {
  select.replaceChildren();
  const sorted = [...models].sort((a, b) => (a.vram || 999999) - (b.vram || 999999));
  for (const model of sorted) {
    const option = document.createElement("option");
    option.value = model.id;
    const isLocal = model.type === "local";
    const ready = isLocal ? !!model.isCached : credentialReady(model.provider, model);
    const status = isLocal ? (ready ? "Cached" : "Needs Download") : (ready ? "Ready" : "Needs Key");
    option.textContent = `${model.label || model.id} [${isLocal ? "Local" : "API"}] — ${status}`;
    select.appendChild(option);
  }
  select.value = selected;
}

export function renderCustomModels(container, models, onRemove) {
  container.replaceChildren();
  if (!models.length) {
    const empty = document.createElement("span");
    empty.className = "modal-copy";
    empty.textContent = "No custom models added.";
    container.appendChild(empty);
    return;
  }
  for (const model of models) {
    const row = document.createElement("div"); row.className = "model-item";
    const text = document.createElement("span");
    const strong = document.createElement("strong"); strong.textContent = model.label || model.id;
    text.appendChild(strong);
    const meta = document.createElement("span"); meta.style.color = "var(--muted-2)"; meta.textContent = ` (${model.protocol})`;
    text.appendChild(meta);
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "icon-btn"; btn.textContent = "×"; btn.title = "Remove";
    btn.addEventListener("click", () => onRemove(model.id));
    row.append(text, btn); container.appendChild(row);
  }
}

export function renderCacheList(container, models) {
  container.replaceChildren();
  if (!models.length) { const p = document.createElement("p"); p.className = "modal-copy"; p.textContent = "No curated local models are available in this browser."; container.appendChild(p); return; }
  for (const model of models) {
    const row = document.createElement("div"); row.className = "cache-item";
    const name = document.createElement("span"); name.textContent = model.label || model.id;
    const status = document.createElement("span"); status.className = `cache-status ${model.isCached ? "" : "missing"}`; status.textContent = model.isCached ? "Cached" : "Not downloaded";
    row.append(name, status); container.appendChild(row);
  }
}
