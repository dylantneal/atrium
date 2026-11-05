/// <reference lib="webworker" />
import { SearchIndex, type SearchDoc, type SearchHit } from '../core/search';

type Msg =
  | { type: 'load'; docs: SearchDoc[] }
  | { type: 'upsert'; doc: SearchDoc }
  | { type: 'remove'; id: string }
  | { type: 'query'; qid: number; q: string; limit: number };

const index = new SearchIndex();

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  if (m.type === 'load') index.load(m.docs);
  else if (m.type === 'upsert') index.upsert(m.doc);
  else if (m.type === 'remove') index.remove(m.id);
  else {
    const hits: SearchHit[] = index.search(m.q, m.limit);
    (self as unknown as Worker).postMessage({ qid: m.qid, hits });
  }
};
