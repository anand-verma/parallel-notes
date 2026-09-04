/** UI components for AI model selection and local model cache management. */
import { PROVIDER_LABELS, API_MODELS } from "../config.js";
import { groupModelsByProvider } from "../ai/model-registry.js";

/* ── Model Picker (toolbar dropdown) ─────────────── */

export function renderModelPickerMenu(container, models, selectedId, { onSelect, onDownload, credentialReady }) {
  container.replaceChildren();
  const groups = groupModelsByProvider(models);
  const order = ["local", "gemini", "openai", "custom"];
  let first = true;

  for (const key of order) {
    const list = groups[key];
    if (!list || !list.length) continue;

    if (!first) {
      const divider = document.createElement("div");
      divider.className = "model-divider";
      container.appendChild(divider);
    }
    first = false;

    const header = document.createElement("div");
    header.className = "model-group-header";
    header.textContent = PROVIDER_LABELS[key] || key;
    container.appendChild(header);

    for (const model of list) {
      const row = document.createElement("div");
      row.className = "model-option" + (model.id === selectedId ? " selected" : "");
      row.dataset.modelId = model.id;

      const info = document.createElement("div");
      info.className = "model-option-info";

      const bullet = document.createElement("span");
      bullet.className = "model-option-bullet";
      info.appendChild(bullet);

      const name = document.createElement("span");
      name.className = "model-option-name";
      name.textContent = model.label || model.id;
      info.appendChild(name);

      const right = document.createElement("div");
      right.className = "model-option-right";

      // Status badge
      const badge = document.createElement("span");
      if (model.type === "local") {
        badge.className = "model-badge " + (model.isCached ? "cached" : "needs-download");
        badge.textContent = model.isCached ? "Cached" : "—";
      } else {
        const ready = credentialReady(model.provider, model);
        badge.className = "model-badge " + (ready ? "ready" : "needs-key");
        badge.textContent = ready ? "Ready" : "Needs Key";
      }
      right.appendChild(badge);

      // Download button for local uncached models
      if (model.type === "local" && !model.isCached) {
        const dlBtn = document.createElement("button");
        dlBtn.type = "button";
        dlBtn.className = "model-option-download";
        dlBtn.title = "Download model";
        dlBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
        dlBtn.addEventListener("click", e => {
          e.stopPropagation();
          onDownload(model.id);
        });
        right.appendChild(dlBtn);
      }

      row.append(info, right);

      row.addEventListener("click", () => {
        onSelect(model.id);
      });

      container.appendChild(row);
    }
  }
}

export function updatePickerTrigger(models, selectedId) {
  const model = models.find(m => m.id === selectedId);
  const providerEl = document.querySelector("#pickerProvider");
  const modelEl = document.querySelector("#pickerModel");
  if (!model) {
    providerEl.textContent = "—";
    modelEl.textContent = "No model";
    return;
  }
  const providerKey = model.type === "local" ? "local" : (model.provider || "custom");
  providerEl.textContent = PROVIDER_LABELS[providerKey] || providerKey;
  modelEl.textContent = model.label || model.id;
}

/* ── Model Cards (Settings → Models tab) ─────────── */

export function renderLocalModelCards(container, models, { onDownload, onRemove }) {
  container.replaceChildren();
  const locals = models.filter(m => m.type === "local");
  if (!locals.length) {
    const empty = document.createElement("p");
    empty.className = "modal-copy";
    empty.textContent = "No local models enabled. Use \"+ Add Local Model\" below.";
    container.appendChild(empty);
    return;
  }
  for (const model of locals) {
    const card = document.createElement("div");
    card.className = "model-card";

    const nameRow = document.createElement("div");
    nameRow.className = "model-card-name";
    nameRow.textContent = model.label || model.id;
    card.appendChild(nameRow);

    const specs = document.createElement("div");
    specs.className = "model-card-specs";
    const addSpec = (label, value) => {
      const el = document.createElement("span");
      el.className = "model-spec";
      el.textContent = `${label}: ${value}`;
      specs.appendChild(el);
    };
    if (model.paramSize && model.paramSize !== "—") addSpec("Params", model.paramSize);
    if (model.vram) addSpec("VRAM", `~${Math.round(model.vram)} MB`);
    if (model.quantization && model.quantization !== "—") addSpec("Quant", model.quantization);
    card.appendChild(specs);

    const status = document.createElement("div");
    status.className = "model-card-status";
    const dot = document.createElement("span");
    dot.style.cssText = `width:7px;height:7px;border-radius:50%;background:${model.isCached ? "var(--success)" : "var(--muted-2)"}`;
    status.appendChild(dot);
    const statusText = document.createElement("span");
    statusText.textContent = model.isCached ? "Cached" : "Not downloaded";
    status.appendChild(statusText);
    card.appendChild(status);

    const actions = document.createElement("div");
    actions.className = "model-card-actions";

    if (!model.isCached) {
      const dlBtn = document.createElement("button");
      dlBtn.type = "button";
      dlBtn.className = "secondary-btn";
      dlBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px; vertical-align:-2px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Download`;
      dlBtn.addEventListener("click", () => onDownload(model.id));
      actions.appendChild(dlBtn);
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "secondary-btn danger-action";
    removeBtn.textContent = "✕ Remove";
    removeBtn.addEventListener("click", () => onRemove(model.id));
    actions.appendChild(removeBtn);

    card.appendChild(actions);
    container.appendChild(card);
  }
}

export function renderApiModelList(container, models, provider, { onRemove }) {
  container.replaceChildren();
  const builtInDefaults = new Set(API_MODELS.filter(m => m.isDefault && m.provider === provider).map(m => m.id));
  const filtered = models.filter(m => m.provider === provider && m.type === "api");

  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "modal-copy";
    empty.textContent = `No ${provider} models configured.`;
    container.appendChild(empty);
    return;
  }

  for (const model of filtered) {
    const row = document.createElement("div");
    row.className = "api-model-row";

    const nameDiv = document.createElement("div");
    nameDiv.className = "api-model-row-name";
    nameDiv.textContent = model.label || model.id;

    if (builtInDefaults.has(model.id)) {
      const badge = document.createElement("span");
      badge.className = "default-badge";
      badge.textContent = "Default";
      nameDiv.appendChild(badge);
    }

    row.appendChild(nameDiv);

    if (!builtInDefaults.has(model.id)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "remove-btn";
      btn.title = "Remove model";
      btn.textContent = "✕";
      btn.addEventListener("click", () => onRemove(model));
      row.appendChild(btn);
    }

    container.appendChild(row);
  }
}

/* ── Custom Models + Cache List (unchanged purpose) ── */

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
    btn.addEventListener("click", () => onRemove(model));
    row.append(text, btn); container.appendChild(row);
  }
}

export function renderCacheList(container, models) {
  container.replaceChildren();
  const locals = models.filter(m => m.type === "local");
  if (!locals.length) {
    const p = document.createElement("p");
    p.className = "modal-copy";
    p.textContent = "No local models are enabled in this browser.";
    container.appendChild(p);
    return;
  }
  for (const model of locals) {
    const row = document.createElement("div"); row.className = "cache-item";
    const name = document.createElement("span"); name.textContent = model.label || model.id;
    const status = document.createElement("span");
    status.className = `cache-status ${model.isCached ? "" : "missing"}`;
    status.textContent = model.isCached ? "Cached" : "Not downloaded";
    row.append(name, status); container.appendChild(row);
  }
}
