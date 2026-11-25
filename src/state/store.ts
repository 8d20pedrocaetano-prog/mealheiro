import { create } from 'zustand';
import type { CsvTable } from '../core/csv';
import { parseTables, type FileMap } from '../core/dataset';
import { todayIso } from '../core/dates';
import { buildModel, type Model } from '../core/model';
import { parseSettings, type Settings } from '../core/schema';

export type Source = { kind: 'demo' } | { kind: 'github'; owner: string; repo: string; branch: string };

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

interface AppState {
  source: Source | null;
  load: LoadState;
  error: string | null;
  tables: Map<string, CsvTable>;
  settings: Settings;
  model: Model | null;
  setData: (files: FileMap, today?: string) => void;
  startDemo: () => Promise<void>;
  leave: () => void;
}

export const useApp = create<AppState>((set) => ({
  source: null,
  load: 'idle',
  error: null,
  tables: new Map(),
  settings: parseSettings(undefined),
  model: null,

  setData(files, today = todayIso()) {
    const tables = parseTables(files);
    const settings = parseSettings(files['settings.json']);
    set({ tables, settings, model: buildModel(tables, settings, today), load: 'ready', error: null });
  },

  async startDemo() {
    set({ source: { kind: 'demo' }, load: 'loading', error: null });
    try {
      const { demoFiles, DEMO_TODAY } = await import('../demo/files');
      useApp.getState().setData(demoFiles, DEMO_TODAY);
    } catch (e) {
      set({ load: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },

  leave() {
    set({ source: null, load: 'idle', model: null, tables: new Map() });
  },
}));

export function useModel(): Model {
  const m = useApp((s) => s.model);
  if (!m) throw new Error('model not loaded');
  return m;
}
