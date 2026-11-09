import { type Editor, Extension } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Heading } from "@tiptap/extension-heading";
import { BulletList, ListItem } from "@tiptap/extension-list";
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
];

type Doc = ReturnType<Editor["getJSON"]>;
export const docJSON = (e: Editor) => e.getJSON() as Doc;
