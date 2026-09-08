import type { Provider } from '@vibe-teacher/shared';
import type { HistoryAdapter } from './types';
import { claudeCodeAdapter } from './claude-code/index';
import { codexAdapter } from './codex/index';
import { copilotCliAdapter } from './copilot-cli/index';
import { copilotVscodeAdapter } from './copilot-vscode/index';

const adapters: HistoryAdapter[] = [claudeCodeAdapter, codexAdapter, copilotCliAdapter, copilotVscodeAdapter];

export function registerAdapter(adapter: HistoryAdapter): void {
  if (!adapters.some((a) => a.provider === adapter.provider)) adapters.push(adapter);
}

export function allAdapters(): HistoryAdapter[] {
  return adapters.slice();
}

export function adapterFor(provider: Provider): HistoryAdapter | undefined {
  return adapters.find((a) => a.provider === provider);
}
