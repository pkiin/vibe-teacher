import type { NormalizedSession, TurnGroup } from '@vibe-teacher/shared';
import { truncate } from '../lib/text';

/** 사람 프롬프트(또는 슬래시 명령) 하나와 다음 프롬프트 전까지의 활동을 묶는다. */
export function buildTurnGroups(session: NormalizedSession): TurnGroup[] {
  const groups: TurnGroup[] = [];
  const mainMessages = session.messages.filter((m) => !m.meta?.subagentId);
  let current: TurnGroup | undefined;
  let lastAssistantText: string | undefined;

  const close = (endIndex: number) => {
    if (!current) return;
    current.messageRange = [current.messageRange[0], endIndex];
    current.finalAssistantText = lastAssistantText ? truncate(lastAssistantText, 300) : undefined;
    groups.push(current);
    current = undefined;
    lastAssistantText = undefined;
  };

  for (const m of mainMessages) {
    if (m.role === 'human' || m.role === 'slash-command') {
      close(m.index - 1);
      current = {
        promptIndex: m.index,
        promptText: m.text ?? '',
        startedAt: m.timestamp,
        messageRange: [m.index, m.index],
        toolCallIds: [],
        filesTouched: [],
      };
      continue;
    }
    if (!current) continue;
    if (m.timestamp) current.endedAt = m.timestamp;
    if (m.role === 'assistant' && m.text) lastAssistantText = m.text;
    if (m.role === 'interrupt') current.interrupted = true;
  }
  const last = mainMessages[mainMessages.length - 1];
  close(last ? last.index : 0);

  // 도구 호출을 그룹에 배정 (서브에이전트 호출은 부모 Agent 메시지 기준)
  for (const tc of session.toolCalls) {
    const idx = tc.parentMessageIndex ?? tc.messageIndex;
    if (idx == null) continue;
    const g = groups.find((gr) => idx >= gr.messageRange[0] && idx <= gr.messageRange[1]);
    if (!g) continue;
    g.toolCallIds.push(tc.id);
    for (const p of tc.paths) if (!g.filesTouched.includes(p)) g.filesTouched.push(p);
    const fr = tc.result?.structured;
    if (fr && 'filePath' in fr && fr.filePath && !g.filesTouched.includes(fr.filePath)) g.filesTouched.push(fr.filePath);
  }
  return groups;
}
