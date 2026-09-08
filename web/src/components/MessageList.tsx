import { useState } from 'react';
import type { UserMessagesResult } from '@vibe-teacher/shared';
import { ko } from '../i18n/ko';
import { fmtDate, fmtSec } from './Notice';

export function MessageList({ result }: { result: UserMessagesResult }) {
  const [copied, setCopied] = useState(false);
  if (!result.items.length) return <div className="muted">{ko.session.noMessages}</div>;
  const copyAll = async () => {
    const text = result.items.map((m, i) => `${i + 1}. ${m.kind === 'slash-command' ? '/' : ''}${m.text}`).join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };
  return (
    <div>
      <div className="row-between">
        <div className="muted small">
          {ko.common.messages} {result.stats.human}개 · {ko.session.slashCommand} {result.stats.slashCommands}개 · 평균 {result.stats.avgChars}자
        </div>
        <button className="btn btn-small" onClick={copyAll}>
          {copied ? ko.common.copied : ko.common.copyAll}
        </button>
      </div>
      <ol className="messages">
        {result.items.map((m, i) => (
          <li key={m.index} id={`msg-${m.index}`} className={`message ${m.kind}`}>
            <div className="message-head">
              <span className="msg-no">{i + 1}</span>
              <span className="muted small">{fmtDate(m.timestamp)}</span>
              {m.kind === 'slash-command' && <span className="pill pill-blue">{ko.session.slashCommand}</span>}
              {m.viaLocalCommand && <span className="pill pill-gray">{ko.session.viaLocalCommand}</span>}
              {m.interruptedNext && <span className="pill pill-red">{ko.session.interrupted}</span>}
              {m.turnDurationSec != null && m.turnDurationSec > 0 && (
                <span className="muted small">
                  {ko.session.turnDuration} {fmtSec(m.turnDurationSec)}
                </span>
              )}
            </div>
            <div className="message-body">{m.kind === 'slash-command' ? `/${m.text}` : m.text}</div>
            {m.openedFiles && m.openedFiles.length > 0 && (
              <div className="chips">
                {m.openedFiles.map((f) => (
                  <span key={f} className="chip mono" title={ko.session.openedFile}>
                    {f.split('/').slice(-2).join('/')}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
