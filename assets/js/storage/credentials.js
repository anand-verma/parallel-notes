/** Secure API key and credential storage management. */
const sessionKeys = new Map();

export function getCredential(provider, settings, model = null) {
  const id = model?.credentialId || provider;
  if (sessionKeys.has(id)) return sessionKeys.get(id) || "";
  if (model?.credentialId) {
    return settings?.customCredentials?.[model.credentialId] || sessionStorage.getItem(`pns.session.${model.credentialId}`) || "";
  }
  return settings?.apiKeys?.[provider] || "";
}

export function setCredential(provider, value, { persist, settings }) {
  const key = String(value || "").trim();
  if (persist) {
    settings.apiKeys ||= {};
    settings.apiKeys[provider] = key;
    sessionKeys.delete(provider);
  } else {
    sessionKeys.set(provider, key);
    if (settings?.apiKeys) settings.apiKeys[provider] = "";
  }
}

export function clearSessionCredentials() {
  sessionKeys.clear();
}

export function setCustomCredential(id, value, { persist, settings }) {
  const credentialId = String(id || "").trim();
  if (!credentialId) return;
  const key = String(value || "").trim();
  sessionKeys.delete(credentialId);
  if (persist) {
    settings.customCredentials ||= {};
    settings.customCredentials[credentialId] = key;
    try { sessionStorage.removeItem(`pns.session.${credentialId}`); } catch {}
  } else {
    delete settings?.customCredentials?.[credentialId];
    try {
      if (key) sessionStorage.setItem(`pns.session.${credentialId}`, key);
      else sessionStorage.removeItem(`pns.session.${credentialId}`);
    } catch {}
  }
}

export function removeCustomCredential(id, settings) {
  const credentialId = String(id || "").trim();
  if (!credentialId) return;
  delete settings?.customCredentials?.[credentialId];
  sessionKeys.delete(credentialId);
  try { sessionStorage.removeItem(`pns.session.${credentialId}`); } catch {}
}

