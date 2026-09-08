import type { NormalizedSession, UserMessageItem, UserMessagesResult } from '@vibe-teacher/shared';
import { buildTurnGroups } from './turn-groups';

export function extractUserMessages(session: NormalizedSession): UserMessagesResult {
  const groups = buildTurnGroups(session);
  const byPrompt = new Map(groups.map((g) => [g.promptIndex, g]));
  const items: UserMessageItem[] = [];
  const msgs = session.messages;
  for (let i = 0; i < msgs.length; i += 1) {
    const m = msgs[i];
    if (!m || m.meta?.subagentId) continue;
    if (m.role !== 'human' && m.role !== 'slash-command') continue;
    const text = m.text ?? '';
    const g = byPrompt.get(m.index);
    let turnDurationSec: number | undefined;
    if (g?.startedAt && g.endedAt) {
      const d = (new Date(g.endedAt).getTime() - new Date(g.startedAt).getTime()) / 1000;
      if (isFinite(d) && d >= 0) turnDurationSec = Math.round(d);
    }
    items.push({
      index: m.index,
      timestamp: m.timestamp,
      kind: m.role,
      text,
      chars: Array.from(text).length,
      openedFiles: m.meta?.openedFiles,
      commandName: m.meta?.commandName,
      interruptedNext: g?.interrupted || undefined,
      turnDurationSec,
      viaLocalCommand: m.meta?.viaLocalCommand || undefined,
    });
  }
  const human = items.filter((i) => i.kind === 'human').length;
  const totalChars = items.reduce((s, i) => s + i.chars, 0);
  return {
    items,
    stats: {
      human,
      slashCommands: items.length - human,
      totalChars,
      avgChars: items.length ? Math.round(totalChars / items.length) : 0,
      firstAt: items[0]?.timestamp,
      lastAt: items[items.length - 1]?.timestamp,
    },
  };
}
