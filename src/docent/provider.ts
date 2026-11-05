import type { Id, Side } from '../data/schema';

export type SortRule = 'color' | 'name' | 'date' | 'size' | 'kind';

/** The typed tool surface. A model-backed provider would emit these calls; the rule-based one parses them from text. */
export type ToolCall =
  | { tool: 'search'; query: string }
  | { tool: 'arrange'; wall: Side | 'aimed' | 'all'; rule: SortRule }
  | { tool: 'summarize' }
  | { tool: 'suggestThreads' }
  | { tool: 'tour' }
  | { tool: 'tagItems'; tags: string[]; scope: 'aimed' | 'room' };

/** Anything that changes files or layout is a proposal: shown as a diff, applied only on confirmation, and undoable. */
export interface Proposal {
  title: string;
  lines: string[];
  apply(): Promise<void>;
}

export interface DocentReply {
  text: string;
  proposal?: Proposal;
}

export interface DocentContext {
  /** Names and metadata only by default; contents are never sent anywhere unless the user opts in per room. */
  shareContents: boolean;
}

export interface DocentProvider {
  readonly name: string;
  /** Turn a message into a tool call (or null if it is not understood). */
  interpret(text: string): ToolCall | null;
}

export interface ThreadSuggestion {
  a: Id;
  b: Id;
  reason: string;
  type: 'derived' | 'project' | 'reference';
}
