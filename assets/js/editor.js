import { Editor, Node, mergeAttributes } from "https://esm.sh/@tiptap/core@3.29.2";
import { StarterKit } from "https://esm.sh/@tiptap/starter-kit@3.29.2";
import { Link } from "https://esm.sh/@tiptap/extension-link@3.29.2";
import { Underline } from "https://esm.sh/@tiptap/extension-underline@3.29.2";
import { TextAlign } from "https://esm.sh/@tiptap/extension-text-align@3.29.2";
import { Table } from "https://esm.sh/@tiptap/extension-table@3.29.2";
import { TableRow } from "https://esm.sh/@tiptap/extension-table-row@3.29.2";
import { TableHeader } from "https://esm.sh/@tiptap/extension-table-header@3.29.2";
import { TableCell } from "https://esm.sh/@tiptap/extension-table-cell@3.29.2";
import { Extension } from "https://esm.sh/@tiptap/core@3.29.2";

/* ── Custom Indent Extension ──────────────────────────────── */
const Indent = Extension.create({
  name: 'indent',
  addOptions() { return { types: ['paragraph', 'heading', 'blockquote', 'listItem'], minIndent: 0, maxIndent: 200, step: 20 } },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          indent: {
            default: 0,
            parseHTML: el => parseInt(el.style.marginLeft, 10) || 0,
            renderHTML: attrs => (!attrs.indent ? {} : { style: `margin-left: ${attrs.indent}px` }),
          },
        },
      },
    ]
  },
  addCommands() {
    return {
      indent: () => ({ tr, state, dispatch }) => {
        const { selection } = state; let docChanged = false;
        state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
          if (this.options.types.includes(node.type.name)) {
            const current = node.attrs.indent || 0;
            const next = Math.min(current + this.options.step, this.options.maxIndent);
            if (current !== next) { tr = tr.setNodeMarkup(pos, null, { ...node.attrs, indent: next }); docChanged = true; }
            return false; // Stop traversing children to prevent double-indenting (e.g. paragraph inside listItem)
          }
          return true;
        });
        if (docChanged && dispatch) { dispatch(tr); return true; }
        return false;
      },
      outdent: () => ({ tr, state, dispatch }) => {
        const { selection } = state; let docChanged = false;
        state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
          if (this.options.types.includes(node.type.name)) {
            const current = node.attrs.indent || 0;
            const next = Math.max(current - this.options.step, this.options.minIndent);
            if (current !== next) { tr = tr.setNodeMarkup(pos, null, { ...node.attrs, indent: next }); docChanged = true; }
            return false;
          }
          return true;
        });
        if (docChanged && dispatch) { dispatch(tr); return true; }
        return false;
      },
    }
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.can().sinkListItem('listItem')) return this.editor.commands.sinkListItem('listItem');
        return this.editor.commands.indent();
      },
      'Shift-Tab': () => {
        if (this.editor.can().liftListItem('listItem')) return this.editor.commands.liftListItem('listItem');
        return this.editor.commands.outdent();
      },
    }
  },
});

/* ── Extensions ──────────────────────────────────────────── */
const extensions=[
  StarterKit,
  Underline,
  Indent,
  Link.configure({openOnClick:false,autolink:true,defaultProtocol:"https"}),
  TextAlign.configure({types:["heading","paragraph"]}),
  Table.configure({resizable:true}),
  TableRow, TableHeader, TableCell
];

/* ── Toolbar definition ──────────────────────────────────── */
const TOOLBAR_ITEMS = [
  { cmd:"bold",         icon:"B",   title:"Bold (Ctrl+B)",           style:"font-weight:800" },
  { cmd:"italic",       icon:"I",   title:"Italic (Ctrl+I)",         style:"font-style:italic" },
  { cmd:"underline",    icon:"U",   title:"Underline (Ctrl+U)",      style:"text-decoration:underline" },
  { cmd:"strike",       icon:"S",   title:"Strikethrough",           style:"text-decoration:line-through" },
  "sep",
  { cmd:"heading1",     icon:"H1",  title:"Heading 1" },
  { cmd:"heading2",     icon:"H2",  title:"Heading 2" },
  { cmd:"heading3",     icon:"H3",  title:"Heading 3" },
  "sep",
  { cmd:"bulletList",   icon:"•≡",  title:"Bullet list (Ctrl+.)" },
  { cmd:"orderedList",  icon:"1≡",  title:"Numbered list (Ctrl+/)" },
  { cmd:"blockquote",   icon:"❝",   title:"Blockquote" },
  { cmd:"code",         icon:"<>",  title:"Inline code" },
  { cmd:"codeBlock",    icon:"{ }", title:"Code block" },
  "sep",
  { type: "dropdown", icon: "▦", title: "Table Tools", items: [
      { cmd: "tableInsert", label: "Insert Table" },
      { cmd: "tableAddRow", label: "Add Row" },
      { cmd: "tableAddCol", label: "Add Column" },
      { cmd: "tableDeleteRow", label: "Delete Row" },
      { cmd: "tableDeleteCol", label: "Delete Column" },
      { cmd: "tableDelete", label: "Delete Table" }
  ]},
  "sep",
  { cmd:"indent",       icon:"⇥",   title:"Indent (Tab)" },
  { cmd:"outdent",      icon:"⇤",   title:"Outdent (Shift+Tab)" },
  "sep",
  { cmd:"horizontalRule", icon:"─", title:"Horizontal rule" },
  { cmd:"link",         icon:"🔗",  title:"Insert / remove link" },
  "sep",
  { cmd:"undo",         icon:"↩",   title:"Undo (Ctrl+Z)" },
  { cmd:"redo",         icon:"↪",   title:"Redo (Ctrl+Y)" }
];

function createToolbar(editor){
  const bar = document.createElement("div");
  bar.className = "editor-toolbar";

  for(const item of TOOLBAR_ITEMS){
    if(item === "sep"){
      const sep = document.createElement("span");
      sep.className = "toolbar-sep";
      bar.appendChild(sep);
      continue;
    }
    
    if(item.type === "dropdown") {
      const dropContainer = document.createElement("div");
      dropContainer.className = "toolbar-dropdown";
      
      const dropBtn = document.createElement("button");
      dropBtn.type = "button";
      dropBtn.className = "toolbar-btn";
      dropBtn.title = item.title;
      dropBtn.textContent = item.icon;
      dropContainer.appendChild(dropBtn);
      
      const menu = document.createElement("div");
      menu.className = "dropdown-menu";
      for (const sub of item.items) {
        const subBtn = document.createElement("button");
        subBtn.type = "button";
        subBtn.dataset.cmd = sub.cmd;
        subBtn.textContent = sub.label;
        subBtn.addEventListener("mousedown", e => {
          e.preventDefault();
          execToolbarCmd(editor, sub.cmd);
        });
        menu.appendChild(subBtn);
      }
      dropContainer.appendChild(menu);
      bar.appendChild(dropContainer);
      continue;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toolbar-btn";
    btn.title = item.title;
    btn.dataset.cmd = item.cmd;
    if(item.style) btn.style.cssText = item.style;
    btn.textContent = item.icon;
    btn.addEventListener("mousedown", e => {
      e.preventDefault();
      execToolbarCmd(editor, item.cmd);
    });
    bar.appendChild(btn);
  }

  editor.on("transaction", () => updateToolbarState(bar, editor));
  return bar;
}

function execToolbarCmd(editor, cmd){
  const chain = editor.chain().focus();
  switch(cmd){
    case "bold":           chain.toggleBold().run(); break;
    case "italic":         chain.toggleItalic().run(); break;
    case "underline":      chain.toggleUnderline().run(); break;
    case "strike":         chain.toggleStrike().run(); break;
    case "heading1":       chain.toggleHeading({level:1}).run(); break;
    case "heading2":       chain.toggleHeading({level:2}).run(); break;
    case "heading3":       chain.toggleHeading({level:3}).run(); break;
    case "bulletList":     chain.toggleBulletList().run(); break;
    case "orderedList":    chain.toggleOrderedList().run(); break;
    case "blockquote":     chain.toggleBlockquote().run(); break;
    case "code":           chain.toggleCode().run(); break;
    case "codeBlock":      chain.toggleCodeBlock().run(); break;
    case "horizontalRule": chain.setHorizontalRule().run(); break;
    case "tableInsert":    chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); break;
    case "tableAddRow":    chain.addRowAfter().run(); break;
    case "tableAddCol":    chain.addColumnAfter().run(); break;
    case "tableDeleteRow": chain.deleteRow().run(); break;
    case "tableDeleteCol": chain.deleteColumn().run(); break;
    case "tableDelete":    chain.deleteTable().run(); break;
    case "link": {
      if(editor.isActive("link")){ chain.unsetLink().run(); }
      else { const url=prompt("URL:"); if(url) chain.setLink({href:url}).run(); }
      break;
    }
    case "indent":
      if (editor.can().sinkListItem("listItem")) chain.sinkListItem("listItem").run();
      else chain.indent().run();
      break;
    case "outdent":
      if (editor.can().liftListItem("listItem")) chain.liftListItem("listItem").run();
      else chain.outdent().run();
      break;
    case "undo": chain.undo().run(); break;
    case "redo": chain.redo().run(); break;
  }
}

function updateToolbarState(bar, editor){
  for(const btn of bar.querySelectorAll(".toolbar-btn")){
    const cmd = btn.dataset.cmd;
    let active = false;
    switch(cmd){
      case "bold":        active = editor.isActive("bold"); break;
      case "italic":      active = editor.isActive("italic"); break;
      case "underline":   active = editor.isActive("underline"); break;
      case "strike":      active = editor.isActive("strike"); break;
      case "heading1":    active = editor.isActive("heading",{level:1}); break;
      case "heading2":    active = editor.isActive("heading",{level:2}); break;
      case "heading3":    active = editor.isActive("heading",{level:3}); break;
      case "bulletList":  active = editor.isActive("bulletList"); break;
      case "orderedList": active = editor.isActive("orderedList"); break;
      case "blockquote":  active = editor.isActive("blockquote"); break;
      case "code":        active = editor.isActive("code"); break;
      case "codeBlock":   active = editor.isActive("codeBlock"); break;
      case "link":        active = editor.isActive("link"); break;
    }
    btn.classList.toggle("active", active);
  }
}

/* ── Public API ──────────────────────────────────────────── */
export function createEditor(element, content, onUpdate){
  const editor=new Editor({
    element,
    extensions,
    content:content || "<p></p>",
    editorProps:{
      handleKeyDown: (view, event) => {
        if (event.ctrlKey || event.metaKey) {
          if (event.key === ".") {
            editor.chain().focus().toggleBulletList().run();
            event.preventDefault(); return true;
          }
          if (event.key === "/") {
            editor.chain().focus().toggleOrderedList().run();
            event.preventDefault(); return true;
          }
        }
        return false;
      },
      attributes:{
        class:"tiptap",
        spellcheck:"true",
        "data-placeholder":"Start writing or paste your notes…"
      }
    },
    onUpdate:({editor})=>onUpdate?.(editor)
  });

  const toolbar = createToolbar(editor);
  element.insertBefore(toolbar, element.firstChild);

  return editor;
}

export function editorText(editor){
  return editor?.getText({blockSeparator:"\n"}) || "";
}

export function selectedText(editor){
  if(!editor) return "";
  const {from,to}=editor.state.selection;
  if(from===to) return "";
  return editor.state.doc.textBetween(from,to,"\n\n");
}

export function wordCount(text){
  return (text.trim().match(/\S+/g)||[]).length;
}
