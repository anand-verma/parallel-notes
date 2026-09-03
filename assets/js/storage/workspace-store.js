/** IndexedDB/LocalStorage logic for persisting workspace documents. */
import { WORKSPACE_STORAGE_VERSION } from "../config.js";

const KEY = "pns.workspace.v2";
const LEGACY_KEY = "pns.workspace.v1";
const CLEAR_MARKER = "pns.workspace.cleared.v1";

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const starter = () => ({
  id: uid(),
  title: "Sample Note",
  source: `<h2>United Nations Reforms</h2><p>The United Nations celebrated its 80th anniversary this week. Reforming the United Nations (UN) is one of the most critical and complex challenges in global governance today. While the UN remains indispensable, its structure, particularly its most powerful bodies, often fails to reflect the realities of the 21st century.</p><h3>Introduction</h3><p>UN reforms refer to proposed and ongoing changes meant to make the United Nations more effective, representative, transparent, and responsive to current global realities. The calls for reform span core UN organs, especially the Security Council, as well as the organization’s operational and financial structures.</p><h3>Key Issues Driving the Need for UN Reforms</h3><ul><li><strong>Outdated Power Structure:</strong> The UN Security Council (UNSC) is dominated by five permanent members (P5: US, UK, France, Russia, China) with veto powers—a structure set in 1945 that now fails to reflect shifts in global power, the rise of developing nations, and the interests of the Global South.</li><li><strong>Veto Deadlock:</strong> The ability of one P5 member to block action causes paralysis in response to major conflicts (Syria, Ukraine), humanitarian crises, and genocide, undermining the Council’s credibility and effectiveness.</li><li><strong>Under-representation:</strong> Countries like India, Brazil, Germany, and Japan, and regions such as Africa and Latin America, have long called for permanent representation to reflect modern realities and give a greater voice to developing nations.</li><li><strong>Bureaucratic Inefficiency:</strong> The sprawling UN bureaucracy often slows emergency response and suffers from corruption, misuse of funds, or poor accountability.</li><li><strong>Financial Dependence:</strong> Reliance on a few donors, especially the US, leads to budgetary crises, delays in humanitarian aid, and concerns about undue influence in UN affairs.</li><li><strong>Erosion of Legitimacy and Emergence of Competitors:</strong> Failures to act on major crises push member states toward regional or ad hoc coalitions (G20, BRICS, African Union), bypassing the UN and weakening its global leadership.</li><li><strong>Defining the Role in Emerging Challenges:</strong> The UN needs a clearer mandate and framework to govern 21st-century threats like climate change &amp; global warming, global health security, artificial intelligence etc.</li></ul><h3>Major Reform Proposals &amp; Ongoing Initiatives</h3><h4>1. UNSC Expansion and Veto Reform</h4><ul><li><strong>New Permanent Members (P6-P11):</strong> The current permanent five (P5: China, France, Russia, UK, US) do not include major modern economic, demographic, or political powers. Leading candidates for new permanent seats include:<ul><li><strong>India:</strong> The world’s most populous country and a major global economy.</li><li><strong>Brazil:</strong> The leading voice in Latin America.</li><li><strong>Germany and Japan:</strong> Major financial contributors to the UN and global powers.</li><li><strong>An African Seat:</strong> A consensus candidate or rotation among key African nations (e.g., Nigeria, South Africa) to represent the entire continent.</li></ul></li><li><strong>Limit or Reform Veto:</strong> Restrict veto use (especially in cases of genocide, war crimes, crimes against humanity) with proposals for supermajority or General Assembly referral for overrides.</li><li><strong>Increase Non-Permanent Seats:</strong> More seats for underrepresented regions to distribute influence and reflect global demographics.</li></ul><h4>2. Streamlining Bureaucracy &amp; Decision Making</h4><ul><li><strong>Cut Costs and Jobs:</strong> Secretary-General’s UN80 initiative includes a 15% budget cut for 2026, reducing staff by over 2,600 posts and streamlining mandates, meetings, and reporting requirements.</li><li><strong>Increase Transparency and Accountability:</strong> Stricter auditing, performance reviews, and publication of program assessments; better mechanisms to address fraud, misconduct, and resource misuse.</li></ul><h4>3. Financial Reform</h4><ul><li><strong>Equitable Assessment &amp; Burden Sharing:</strong> Update member contribution formulas based on GDP, population, and development indicators; build in accountability for arrears and fiscal discipline.</li><li><strong>Link Membership to Contributions:</strong> Greater privileges or representation for consistent contributors to peacekeeping, aid, or development.</li></ul><h4>4. Inclusive Voice and Representation</h4><ul><li><strong>Institutionalize Global South Forums:</strong> Permanent coalitions (e.g., G4, African Union blocks) within UN organs to negotiate as regional blocs and ensure developing country priorities are addressed.</li><li><strong>Text-Based Negotiations:</strong> Adopt clear deadlines and rounds for reform discussions, preventing procedural delays.</li><li><strong>Periodic Review Mechanisms:</strong> Institutionalize a process for periodic assessment and adjustment of governance structures and policies (such as a standing UN Reform Commission).</li></ul><h3>Challenges to UN Reforms</h3><ul><li><strong>Veto Power and Security Council Dynamics:</strong> The UN Security Council’s five permanent members (P5) hold veto power, which allows any one of them to block substantive reforms, including changes to the Council itself—even reforms that enjoy broad international support.</li><li><strong>Geopolitical Rivalries and National Interests:</strong> Competing national interests and regional rivalries between major powers and emerging economies complicate negotiations on reforms. Countries like India, Brazil, Germany, Japan, and African nations demand permanent Security Council seats, but this is contested by others with divergent interests.</li><li><strong>Constitutional and Legal Barriers:</strong> UN Charter amendments require approval by two-thirds of the General Assembly members and all P5 countries. This high threshold makes reform legally and procedurally difficult. Existing procedures are cumbersome, and there is no standing mechanism to expedite or enforce reforms.</li><li><strong>Institutional Inertia and Bureaucratic Resistance:</strong> UN’s bureaucratic structure is large and complex, with entrenched interests and resistance to change. Budgetary, administrative, and mandate reforms are often resisted by internal UN agencies and member states benefitting from the status quo.</li><li><strong>Fragmentation and Lack of Political Will:</strong> Divisions among member states, shifting alliances, and the rise of alternative multilateral platforms (G20, BRICS, regional organizations) lead to fragmented global governance, diverting momentum away from comprehensive UN reform. The absence of unified leadership and hesitation from powerful states creates a political vacuum, limiting sustained reform efforts.</li><li><strong>Funding and Financial Dependence:</strong> UN’s operational effectiveness depends on contributions from a few major donors, primarily Western countries like the U.S. Member states reluctant to increase funding or subject their contributions to reform conditions create financial constraints that undermine reform implementation.</li><li><strong>Representation and Inclusivity Conflicts:</strong> Diverse views on how to democratize or broaden representation create further disagreements, especially between developed and developing countries. Differing visions on representation of the Global South, small states, and non-state actors complicate the design of an inclusive governance model.</li></ul><h3>Conclusion</h3><p>UN reform faces formidable roadblocks from entrenched power structures, competing national interests, high legal thresholds, organizational inertia, and lack of unified political will. Overcoming these challenges requires sustained global diplomacy, balancing realism and idealism to adapt the UN for contemporary global governance.</p>`,
  result: `<p><strong>Try “Short Notes”</strong> to compress the sample source. The result stays fully editable.</p>`,
  updatedAt: Date.now()
});

export function emptyWorkspace() {
  const doc = normalizeDoc({ title: "Untitled Notes", source: "<p></p>", result: "<p></p>", single: "<p></p>" });
  return { version: WORKSPACE_STORAGE_VERSION, documents: [doc], activeId: doc.id, view: "dual", mode: "short", customInstruction: "", paneRatio: 50 };
}

export function clearWorkspaceStorage() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(LEGACY_KEY);
  localStorage.removeItem(CLEAR_MARKER);
  return emptyWorkspace();
}

function defaults() {
  const doc = starter();
  return { version: WORKSPACE_STORAGE_VERSION, documents: [doc], activeId: doc.id, view: "dual", mode: "short", customInstruction: "", paneRatio: 50 };
}

function normalizeDoc(doc) {
  return {
    id: doc?.id || uid(),
    title: doc?.title || "Untitled Notes",
    source: doc?.source || "<p></p>",
    result: doc?.result || "<p></p>",
    single: doc?.single || "<p></p>",
    updatedAt: doc?.updatedAt || Date.now()
  };
}

function migrate(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.documents) || !raw.documents.length) return defaults();
  return {
    ...defaults(),
    ...raw,
    version: WORKSPACE_STORAGE_VERSION,
    documents: raw.documents.map(normalizeDoc),
    paneRatio: Math.max(25, Math.min(75, Number(raw.paneRatio) || 50))
  };
}

export function loadWorkspace() {
  try {
    const current = localStorage.getItem(KEY);
    if (current) return migrate(JSON.parse(current));
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const migrated = migrate(JSON.parse(legacy));
      localStorage.setItem(KEY, JSON.stringify(migrated));
      localStorage.removeItem(LEGACY_KEY);
      return migrated;
    }
    return defaults();
  } catch {
    return defaults();
  }
}

export function saveWorkspace(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...state, version: WORKSPACE_STORAGE_VERSION }));
    return true;
  } catch (error) {
    const message = error?.name === "QuotaExceededError"
      ? "Workspace storage is full. Delete old documents or clear site data to continue saving."
      : "Workspace could not be saved in this browser.";
    const wrapped = new Error(message);
    wrapped.cause = error;
    throw wrapped;
  }
}

export function activeDocument(state) {
  return state.documents.find(d => d.id === state.activeId) || state.documents[0];
}

export function createDocument(state, title = "Untitled Notes") {
  const doc = normalizeDoc({ id: uid(), title, source: "<p></p>", result: "<p></p>", single: "<p></p>" });
  state.documents.unshift(doc);
  state.activeId = doc.id;
  saveWorkspace(state);
  return doc;
}

export function deleteDocument(state, id) {
  if (state.documents.length === 1) return false;
  state.documents = state.documents.filter(d => d.id !== id);
  if (state.activeId === id) state.activeId = state.documents[0].id;
  saveWorkspace(state);
  return true;
}

export function getStorageUsage() {
  try {
    const data = localStorage.getItem(KEY) || "";
    return new Blob([data]).size;
  } catch {
    return 0;
  }
}
