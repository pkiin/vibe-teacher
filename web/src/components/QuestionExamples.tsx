import { ko } from '../i18n/ko';

export function QuestionExamples({ label, kind, disabled, onAsk }: { label: string; kind: string; disabled: boolean; onAsk: (question: string) => void }) {
  return <div className="question-examples">
    <strong className="small">{ko.help.examples}</strong> <span className="small muted">{ko.help.examplesNote}</span>
    <div className="question-example-list">{ko.help.questionExamples(label, kind).map((question) => <button key={question} type="button" className="btn btn-small" disabled={disabled} onClick={() => onAsk(question)}>{question}</button>)}</div>
  </div>;
}
