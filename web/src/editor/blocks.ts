import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";

/**
 * Turn the bullet under the cursor into a header. Works on the top-level bullet that contains the
 * cursor; its nested bullets stay as bullets under the new header.
 */
export function toHeader(editor: Editor): boolean {
  const { state, view } = editor;
  const { $from } = state.selection;
  if ($from.depth < 2 || $from.node(1).type.name !== "bulletList") return false;
  const { schema } = state;
  const listNode = $from.node(1);
  const listPos = $from.before(1);
  const idx = $from.index(1);
  const li = listNode.child(idx);
  const label = li.firstChild?.textContent ?? "";
  const head = schema.nodes.heading.create({ level: 1 }, label ? schema.text(label) : undefined);
  const nested: PMNode[] = li.childCount > 1 ? li.child(1).content.content.slice() : [];
  const before: PMNode[] = [];
  const after: PMNode[] = [];
  listNode.forEach((child, _o, i) => {
    if (i < idx) before.push(child);
    else if (i > idx) after.push(child);
  });
  const tail = [...nested, ...after];
  const nodes: PMNode[] = [];
  if (before.length) nodes.push(schema.nodes.bulletList.create(null, before));
  const headStart = listPos + nodes.reduce((n, x) => n + x.nodeSize, 0);
  nodes.push(head);
  if (tail.length) nodes.push(schema.nodes.bulletList.create(null, tail));
  const tr = state.tr.replaceWith(listPos, listPos + listNode.nodeSize, nodes);
  tr.setSelection(TextSelection.create(tr.doc, headStart + 1 + head.content.size));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

/** Turn the header under the cursor into a bullet, joining the bullet lists around it. */
export function toBody(editor: Editor): boolean {
  const { state, view } = editor;
  const { $from } = state.selection;
  if ($from.parent.type.name !== "heading" || $from.depth !== 1) return false;
  const { schema } = state;
  const doc = state.doc;
  const idx = $from.index(0);
  const headPos = $from.before(1);
  const head = $from.parent;
  const prev = idx > 0 ? doc.child(idx - 1) : null;
  const next = idx < doc.childCount - 1 ? doc.child(idx + 1) : null;
  const item = schema.nodes.listItem.create(
    null,
    schema.nodes.paragraph.create(null, head.textContent ? schema.text(head.textContent) : undefined),
  );
  const prevList = prev?.type.name === "bulletList" ? prev : null;
  const nextList = next?.type.name === "bulletList" ? next : null;
  const items = [...(prevList?.content.content ?? []), item, ...(nextList?.content.content ?? [])];
  const from = prevList ? headPos - prevList.nodeSize : headPos;
  const to = headPos + head.nodeSize + (nextList?.nodeSize ?? 0);
  const itemPos = from + 1 + (prevList?.content.size ?? 0);
  const tr = state.tr.replaceWith(from, to, schema.nodes.bulletList.create(null, items));
  tr.setSelection(TextSelection.create(tr.doc, itemPos + 2 + item.firstChild!.content.size));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}
