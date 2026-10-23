import { ko } from '../i18n/ko';

export function ReadingGuide() {
  return (
    <details className="reading-guide card">
      <summary>{ko.reading.guide}</summary>
      <p className="muted">{ko.reading.guideIntro}</p>
      <dl className="term-grid">
        {ko.reading.terms.map(({ term, meaning }) => (
          <div key={term}><dt>{term}</dt><dd>{meaning}</dd></div>
        ))}
      </dl>
    </details>
  );
}
