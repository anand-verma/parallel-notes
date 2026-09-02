const sessionKeys = new Map();

export function getCredential(provider, settings, model = null) {
  const id = model?.credentialId || provider;
  if (sessionKeys.has(id)) return sessionKeys.get(id) || "";
  if (model?.credentialId) {
    return settings?.customCredentials?.[model.credentialId] || sessionStorage.getItem(`rns.session.${model.credentialId}`) || "";
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

export function clearSessionCredentials() { sessionKeys.clear(); }
