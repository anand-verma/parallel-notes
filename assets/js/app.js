/** Main application entry point; initializes state and UI. */
import { APP_VERSION } from "./config.js";
import { loadState } from "./state.js";
import { AppUI } from "./ui.js";

const state = loadState();
const ui = new AppUI(state);
ui.init();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register(`./sw.js?v=${APP_VERSION}`).catch(() => {}));
}
