import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { RepoSource } from '@vibe-teacher/shared';
import { ko } from '../i18n/ko';

const t = ko.guide;

/**
 * 사용 방법 안내(처음 순서 · 화면별 버튼 → 하는 일 → 쓰면 좋은 때 · 자주 묻는 질문)를 그린다.
 * 앱의 '사용 방법' 탭(정해 둔 안내)과 레포 위키의 '어떻게 사용하나요?'(AI 가 저장소마다 쓴 안내)가 함께 쓴다.
 */
export interface GuideViewItem { name: string; what: string; tip?: string; label?: string; sources?: RepoSource[] }
export interface GuideViewPart<I extends GuideViewItem = GuideViewItem> { title?: string; items: I[] }
export interface GuideViewSection<I extends GuideViewItem = GuideViewItem> { id: string; title: string; where: string; intro: string; parts: GuideViewPart<I>[] }
export interface GuideViewStep { title: string; text: string; to?: string; sources?: RepoSource[] }
export interface GuideViewFaq { q: string; a: string; sources?: RepoSource[] }

/** 찾기 칸에 넣은 말이 들어 있는 항목만 남긴다. 절 제목이 맞으면 그 절 전체를 보여 준다 */
export function filterGuide<S extends GuideViewSection>(sections: S[], query: string): S[] {
  const q = query.trim().toLowerCase();
  if (!q) return sections;
  const has = (...texts: (string | undefined)[]) => texts.some((text) => text?.toLowerCase().includes(q));
  return sections.flatMap((section) => {
    if (has(section.title)) return [section];
    const parts = section.parts
      .map((part) => (has(part.title) ? part : { ...part, items: part.items.filter((item) => has(item.name, item.label, item.what, item.tip)) }))
      .filter((part) => part.items.length > 0);
    return parts.length ? [{ ...section, parts } as S] : [];
  });
}

const count = (sections: GuideViewSection[]) => sections.reduce((n, s) => n + s.parts.reduce((m, p) => m + p.items.length, 0), 0);

type Sources = (sources?: RepoSource[]) => ReactNode;

function Item({ item, sources }: { item: GuideViewItem; sources?: Sources }) {
  return (
    <div className="guide-item">
      <dt>
        <span className="guide-name">{item.name}</span>
        {item.label && <span className="guide-label small" title={ko.usage.labelTitle}>{item.label === item.name ? ko.usage.labelSame : `“${item.label}”`}</span>}
      </dt>
      <dd>
        <p>{item.what}</p>
        {item.tip && <p className="guide-tip"><strong>{t.tip}</strong> {item.tip}</p>}
        {sources?.(item.sources)}
      </dd>
    </div>
  );
}

export function GuideView({ idPrefix, steps, sections: all, faq, placeholder, sources }: {
  /** 절·질문·찾기 칸 id 앞에 붙인다 (같은 화면의 다른 목차와 겹치지 않게) */
  idPrefix: string;
  steps: GuideViewStep[];
  sections: GuideViewSection[];
  faq: GuideViewFaq[];
  placeholder: string;
  /** 근거 표시 (레포 위키의 안내만) */
  sources?: Sources;
}) {
  const [query, setQuery] = useState('');
  const sections = filterGuide(all, query);
  const searching = query.trim().length > 0;
  return (
    <div className="guide-view">
      {!searching && steps.length > 0 && (
        <section className="card guide-flow" aria-labelledby={`${idPrefix}-flow-title`}>
          <h2 id={`${idPrefix}-flow-title`}>{t.flowTitle}</h2>
          <ol>
            {steps.map((step, i) => (
              <li key={`${i}-${step.title}`}>
                <strong>{step.title}</strong>
                <span>{step.text}</span>
                {step.to && <Link className="small" to={step.to}>{t.open} →</Link>}
                {sources?.(step.sources)}
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="guide-search" role="search">
        <label htmlFor={`${idPrefix}-search`}>{t.search}</label>
        <input id={`${idPrefix}-search`} type="search" value={query} maxLength={100} placeholder={placeholder} onChange={(e) => setQuery(e.target.value)} />
        {searching && <span className="small muted" role="status">{sections.length ? t.found(count(sections)) : t.notFound}</span>}
      </div>

      {sections.length > 0 && (
        <nav className="repo-toc small" aria-label={t.contents}>
          {sections.map((s) => <a key={s.id} href={`#${idPrefix}-${s.id}`}>{s.title}</a>)}
          {!searching && faq.length > 0 && <a href={`#${idPrefix}-faq`}>{t.faqTitle}</a>}
        </nav>
      )}

      {sections.map((section) => (
        <section key={section.id} className="card guide-section" id={`${idPrefix}-${section.id}`}>
          <h2>{section.title}</h2>
          {section.where && <p className="guide-where"><span className="pill pill-blue">{t.where}</span> {section.where}</p>}
          {section.intro && <p>{section.intro}</p>}
          {section.parts.map((part, i) => (
            <div key={part.title ?? i} className="guide-part">
              {part.title && <h3>{part.title}</h3>}
              <dl className="guide-items">{part.items.map((item) => <Item key={item.name} item={item} {...(sources ? { sources } : {})} />)}</dl>
            </div>
          ))}
        </section>
      ))}

      {!searching && faq.length > 0 && (
        <section className="card guide-section" id={`${idPrefix}-faq`}>
          <h2>{t.faqTitle}</h2>
          {faq.map((f, i) => (
            <details key={`${i}-${f.q}`} className="guide-faq">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
              {sources?.(f.sources)}
            </details>
          ))}
        </section>
      )}
    </div>
  );
}
