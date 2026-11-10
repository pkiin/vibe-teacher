import type { Account, AuthMeResponse } from '@vibe-teacher/shared';
import { GuideView } from '../components/GuideView';
import { Breadcrumb } from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { useTechnicalDetails } from '../hooks/useTechnicalDetails';
import { guideFaq, guideSections, guideSteps, type GuideAudience, type GuideSection, type GuideViewer } from '../i18n/guide';
import { ko } from '../i18n/ko';

const t = ko.guide;

/** 지금 사용자에게 보이는 버튼을 화면과 같은 조건으로 정한다 (Layout·AccountsPage·StartPage·UnifiedAiPanel) */
export function guideViewer(me: AuthMeResponse | null, technical: boolean, accounts: Account[] | null): GuideViewer {
  const list = accounts ?? [];
  const readable = list.filter((a) => a.readable === 'ok').length;
  return {
    installation: !!me?.canManageInstallation,
    ownKey: !!me?.openRouterKey,
    accountSelect: readable > 1,
    accountCards: list.length > 1 || (list.length === 1 && readable === 0),
    signedIn: !!me && me.mode !== 'none' && me.authenticated,
    member: me?.mode === 'supabase',
    pending: me?.mode === 'supabase' && !me.approved,
    technical,
  };
}

const shows = (viewer: GuideViewer) => (x: { show?: GuideAudience }) => !x.show || viewer[x.show];

/** 지금 사용자에게 보이지 않는 버튼의 안내를 빼고, 비게 된 묶음과 절도 뺀다 */
export function visibleGuide(sections: GuideSection[], viewer: GuideViewer): GuideSection[] {
  return sections.flatMap((section) => {
    const parts = section.parts.map((part) => ({ ...part, items: part.items.filter(shows(viewer)) })).filter((part) => part.items.length > 0);
    return parts.length ? [{ ...section, parts }] : [];
  });
}

export { filterGuide } from '../components/GuideView';

/** 사용 방법: 화면별 버튼·기능이 하는 일과 쓰면 좋은 때 */
export function GuidePage() {
  const { me } = useAuth();
  const technical = useTechnicalDetails();
  const canQuery = !!me && (me.authenticated || me.mode === 'none');
  const accounts = useApi<Account[]>(canQuery ? '/api/accounts' : null, [me?.username]);
  const viewer = guideViewer(me, technical, accounts.data);
  const faq = guideFaq.filter(shows(viewer));
  const sections = visibleGuide(guideSections, viewer);
  return (
    <div className="page guide-page">
      <Breadcrumb items={[{ label: t.title }]} />
      <h1>{t.title}</h1>
      <p>{t.intro}</p>
      <div className="notice notice-info guide-support" role="note"><p><strong>{t.supportTitle}</strong><br />{t.supportText}</p></div>
      <p className="small muted">{t.note} {t.mine}</p>
      <GuideView idPrefix="guide" steps={guideSteps} sections={sections} faq={faq} placeholder={t.searchPlaceholder} />
    </div>
  );
}
