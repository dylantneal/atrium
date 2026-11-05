// Loaded lazily the first time a text file is opened, so CodeMirror stays out of the initial bundle.
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';

const theme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: '#16141d', color: '#ece8f2' },
    '.cm-content': { caretColor: '#ffb25b', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '14px', padding: '12px 0' },
    '.cm-scroller': { overflow: 'auto' },
    '.cm-gutters': { backgroundColor: '#16141d', color: '#6b6580', border: 'none' },
    '.cm-activeLine': { backgroundColor: '#1f1c2a' },
    '.cm-activeLineGutter': { backgroundColor: '#1f1c2a' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#3a3358' },
    '.cm-cursor': { borderLeftColor: '#ffb25b' },
  },
  { dark: true },
);

function langFor(name: string): Extension[] {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (ext === 'md' || ext === 'markdown') return [markdown()];
  if (ext === 'json') return [json()];
  if (['js', 'ts', 'jsx', 'tsx'].includes(ext)) return [javascript({ typescript: ext.startsWith('t') })];
  return [];
}

export interface Editor {
  view: EditorView;
  getText(): string;
  focus(): void;
  destroy(): void;
}

export function createEditor(parent: HTMLElement, doc: string, name: string, onChange: (text: string) => void, onSave: () => void): Editor {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        theme,
        EditorView.lineWrapping,
        ...langFor(name),
        keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (onSave(), true) }]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange(u.state.doc.toString());
        }),
      ],
    }),
  });
  return { view, getText: () => view.state.doc.toString(), focus: () => view.focus(), destroy: () => view.destroy() };
}
