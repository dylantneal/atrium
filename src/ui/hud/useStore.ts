import { useEffect, useState } from 'preact/hooks';
import type { Store } from '../../core/store';

export function useStore<S>(store: Store<S>): S {
  const [s, setS] = useState(store.get());
  useEffect(() => store.subscribe((n) => setS(n)), [store]);
  return s;
}
