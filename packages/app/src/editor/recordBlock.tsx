import { useMemo } from 'react';
import { Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { RECORD_LINK_TITLE } from '@ergonotes/core';
import { RecordPlayer } from '../components/RecordPlayer';
import { vaultPathsOf } from '../state/noteCtx';

type Out = { write(s: string): void; closeBlock(n: unknown): void };

function RecordView({ node, selected, editor, getPos }: NodeViewProps) {
  const href = String(node.attrs.path);
  const label = String(node.attrs.label || 'Record');
  const paths = useMemo(() => vaultPathsOf(href), [href]);
  const insertAfter = (md: string) => {
    const pos = getPos();
    if (typeof pos === 'number') editor.chain().focus().insertContentAt(pos + node.nodeSize, md).run();
  };
  return (
    <NodeViewWrapper className={`record-wrap${selected ? ' ProseMirror-selectednode' : ''}`} contentEditable={false} data-drag-handle>
      <RecordPlayer paths={paths} label={label} insertAfter={insertAfter} />
    </NodeViewWrapper>
  );
}

/** A record (ADR 0011): `[label](attachments/record_… "type_record")`, shown as a player. */
export const RecordBlock = Node.create({
  name: 'recordBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() { return { path: { default: '' }, label: { default: 'Record' } }; },
  parseHTML() {
    return [{ tag: 'div[data-record]', getAttrs: el => ({ path: (el as HTMLElement).getAttribute('data-record'), label: (el as HTMLElement).getAttribute('data-label') ?? 'Record' }) }];
  },
  renderHTML({ node }) { return ['div', { 'data-record': node.attrs.path, 'data-label': node.attrs.label }]; },
  addNodeView() { return ReactNodeViewRenderer(RecordView); },
  addStorage() {
    return {
      markdown: {
        serialize(state: Out, node: { attrs: { path: string; label: string } }) {
          state.write(`[${String(node.attrs.label).replace(/[\[\]\n]/g, ' ')}](${node.attrs.path} "${RECORD_LINK_TITLE}")`);
          state.closeBlock(node);
        },
        parse: {
          updateDOM(root: HTMLElement) {
            root.querySelectorAll(`p > a[title="${RECORD_LINK_TITLE}"]`).forEach(a => {
              const p = a.parentElement!;
              const href = a.getAttribute('href') ?? '';
              // a record is a link to a folder of the vault: a web address stays an ordinary link
              if (p.childNodes.length !== 1 || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return;
              const d = document.createElement('div');
              d.setAttribute('data-record', href);
              d.setAttribute('data-label', a.textContent ?? 'Record');
              p.replaceWith(d);
            });
          },
        },
      },
    };
  },
});
