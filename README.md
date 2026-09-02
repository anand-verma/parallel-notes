Parallel Notes

Parallel Notes is a privacy-first, browser-based study and revision
workspace that turns long parent/source notes into concise, editable
revision notes while keeping the original material intact.

Select → Summarize → Edit

If text is selected in the Parent Notes pane, only the selected passage
is transformed. If nothing is selected, the complete Parent Notes pane
is summarized.

Features

Two-pane Parent Notes → Summary Notes workflow.

Rich-text editing with Tiptap.

Full-document or selection-based AI transformation.

Short Notes, Super-Short Notes, Structured Notes, Comparison,
Concept / Flow, and Custom modes.

Source-bound prompting designed to prevent unsupported facts and
"helpful" expansion.

Progressive AI output while generation is running.

Red Stop control that preserves partial output.

Local WebLLM inference.

Lightweight curated local models:

Qwen2.5-1.5B-Instruct-q4f16_1-MLC

Llama-3.2-1B-Instruct-q4f16_1-MLC

Llama-3.2-1B-Instruct-q4f32_1-MLC

Gemini and OpenAI-compatible cloud APIs.

Custom OpenAI-compatible API endpoints.

Local persistence of both Parent Notes and Summary Notes.

Document create, rename, delete, and active-document management.

Generating documents are highlighted and promoted to the top of the
document list.

WebLLM model cache management.

Workspace-only deletion from Settings.

Export and clipboard support.

GitHub Pages/static-hosting friendly architecture.

AI workflow

Parent Notes
│
├── selection exists ──→ selected passage + limited context
│
└── no selection ─────→ complete Parent Notes
│
▼
Prompt Builder
│
▼
AI Provider
┌──────┼──────┐
│ │ │
WebLLM Gemini OpenAI-compatible
│ │ │
└──────┼──────┘
▼
Streaming result
▼
Summary Notes

The Parent Notes pane is never replaced by AI output.

Source-bound AI

The AI is instructed to use the supplied source as the factual
authority. It should:

preserve meaning and important qualifiers;

preserve dates, numbers, names, institutions, laws, provisions,
examples, classifications, and relationships present in the source;

remove repetition and low-information wording;

avoid unsupported facts and outside knowledge;

avoid correcting, researching, or expanding the source;

prefer deleting uncertain material over inferring it.

The goal is compression, not research.

Local AI and privacy

When WebLLM is selected, inference runs in the browser using the local
model and WebGPU/WASM capabilities where supported.

Cloud providers are optional. When a cloud provider is selected, the
relevant source text is sent to that provider according to its API
behavior.

API keys are stored locally when the user chooses to remember them.
Browser-local storage is convenient storage, not a secure secret vault.

Storage and cache

Workspace documents and settings are stored locally in the browser.

Workspace deletion is intentionally separate from model-cache deletion:

Delete All Workspace Documents removes saved notes.

WebLLM model cache is managed separately.

Service-worker caches are scoped to the application's own cache
namespace.

Browser Clear Site Data is broader and can remove localStorage,
IndexedDB, Cache Storage, service-worker data, and other site data
depending on the browser.

Architecture

assets/js/
├── app.js
├── config.js
├── state.js
├── storage/
│ ├── workspace-store.js
│ ├── settings-store.js
│ └── credentials.js
├── editor/
│ ├── editor.js
│ ├── toolbar.js
│ └── selection.js
├── ai/
│ ├── ai-service.js
│ ├── controller.js
│ ├── model-registry.js
│ ├── source-package.js
│ ├── prompts.js
│ ├── stream.js
│ └── providers/
│ ├── webllm.js
│ ├── gemini.js
│ └── openai-compatible.js
├── services/
│ ├── markdown.js
│ ├── clipboard.js
│ └── export.js
└── ui/
├── ai-ui.js
└── settings-ui.js

The application is intentionally modular while remaining a static
HTML/CSS/JavaScript project.

Technology

HTML

CSS

JavaScript

Tiptap

WebLLM

WebGPU/WASM

Gemini API

OpenAI-compatible APIs

Browser local storage

Service Worker

GitHub Pages-compatible static hosting

No Node.js runtime or backend server is required for deployment.

Local development

Serve the project through an HTTP server during development rather than
opening index.html directly with file://. This is important for
browser modules, service workers, caching, and local WebGPU behavior.

Deployment

Parallel Notes can be deployed as a static website, including GitHub
Pages.

See docs/DEPLOY_GITHUB_PAGES.md for deployment details.

Model benchmarking

Parameter count alone should not determine the preferred model. For this
application, benchmark:

model download size;

initial load time;

cache load time;

first-token latency;

tokens/second;

memory usage;

compression ratio;

fact preservation;

hallucination rate;

meaning preservation;

qualifier preservation;

formatting consistency;

instruction adherence.

The best model is the one that compresses reliably while remaining fast
enough for the target device.

Testing checklist

Full Parent Notes summarization works.

Selection-only summarization works.

Parent Notes remain unchanged.

Summary Notes remain editable.

Both panes survive reload.

Model loading percentage appears.

Output streams progressively.

Stop preserves partial output.

Failed generation shows a failed status.

Rename and delete work.

Generating document moves to the top and is highlighted.

WebLLM cache management does not delete workspace data.

Delete All Workspace Documents does not delete model cache.

Settings and API configuration remain intact after workspace
deletion.

Credits

Built with ❤️ by Anand.

Feedback is available through the Feedback link in the application.

License

See LICENSE for license terms.
