import { type Editor, Extension } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Heading } from "@tiptap/extension-heading";
import { BulletList, ListItem } from "@tiptap/extension-list";
import { TextSelection } from "@tiptap/pm/state";
import { StarterKit } from "@tiptap/starter-kit";

/** Enter in a header continues with a bullet, so a free paragraph can never exist. */
const HeaderEnter = Extension.create({
  name: "headerEnter",
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection;
        if ($from.parent.type.name !== "heading") return false;
        const after = $from.after();
        const next = editor.state.doc.nodeAt(after);
        const bullet = { type: "listItem", content: [{ type: "paragraph" }] };
        return next?.type.name === "bulletList"
          ? editor
              .chain()
              .insertContentAt(after + 1, bullet)
              .setTextSelection(after + 3)
              .run()
          : editor
              .chain()
              .insertContentAt(after, { type: "bulletList", content: [bullet] })
              .setTextSelection(after + 3)
              .run();
      },
    };
  },
});

/** Backspace on an empty bullet deletes it (default lift would leave a free paragraph, which the schema forbids). */
const BulletBackspace = Extension.create({
  name: "bulletBackspace",
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { selection, doc } = editor.state;
        const { $from } = selection;
        if (!selection.empty || $from.parent.type.name !== "paragraph") return false;
        if ($from.parent.content.size !== 0 || $from.depth < 2) return false;
        const item = $from.node(-1);
        if (item.type.name !== "listItem" || item.childCount > 1) return false;
        const list = $from.node(-2);
        const soleItem = list.childCount === 1;
        const from = soleItem ? $from.before(-2) : $from.before(-1);
        const to = soleItem ? $from.after(-2) : $from.after(-1);
        // The document needs at least one block.
        if (soleItem && doc.childCount === 1) return false;
        return editor
          .chain()
          .deleteRange({ from, to })
          .command(({ tr }) => {
            tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(from, tr.doc.content.size)), -1));
            return true;
          })
          .run();
      },
    };
  },
});

export const extensions = [
  StarterKit.configure({
    document: false,
    heading: false,
    bulletList: false,
    listItem: false,
    orderedList: false,
    blockquote: false,
    codeBlock: false,
    horizontalRule: false,
    hardBreak: false,
    strike: false,
    code: false,
    link: false,
    underline: false,
    trailingNode: false,
  }),
  // The document is a flat run of headers and bullet lists; nothing else.
  Document.extend({ content: "(heading | bulletList)+" }),
  Heading.extend({ marks: "" }).configure({ levels: [1] }),
  BulletList,
  ListItem.extend({ content: "paragraph bulletList?" }),
  HeaderEnter,
  BulletBackspace,
];

type Doc = ReturnType<Editor["getJSON"]>;
export const docJSON = (e: Editor) => e.getJSON() as Doc;
