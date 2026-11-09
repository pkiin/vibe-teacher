import { REPO_USAGE_LIMITS } from '@vibe-teacher/shared';
import { ko } from './ko';

/**
 * '사용 방법' 탭의 내용. 쓰는 사람 입장에서 화면별 버튼·기능이 하는 일과 쓰면 좋은 때를 적는다.
 * 버튼 이름은 ko 의 화면 문구를 그대로 참조해 버튼 이름이 바뀌면 안내도 함께 바뀌게 한다.
 * 운영·관리자 기능(회원 관리, 서버 설정 등)은 여기에 쓰지 않는다.
 * 권한·설정에 따라 보이는 버튼은 show 로 화면과 같은 조건을 달아, 그 버튼이 보이는 사람에게만 안내한다.
 */

/**
 * 이 항목이 보이는 사람 (GuidePage 의 guideViewer 가 화면과 같은 조건으로 정한다). 없으면 모든 사용자.
 * - installation: 소스 설정을 다루는 사람 (me.canManageInstallation)
 * - ownKey: 화면에서 OpenRouter 키를 넣는 노트북 설치 소유자 (me.openRouterKey)
 * - accountSelect: 위쪽 메뉴의 계정 선택 칸이 보임 (읽을 수 있는 계정 둘 이상)
 * - accountCards: 내 프로젝트에서 계정 카드가 보임 (바로 한 계정으로 넘어가지 않음)
 * - signedIn: 로그아웃 버튼이 보임
 * - member: 이메일 회원 로그인
 * - pending: AI 사용 승인 대기
 * - technical: 기술 정보를 보는 사람 (useTechnicalDetails)
 */
export type GuideAudience = 'installation' | 'ownKey' | 'accountSelect' | 'accountCards' | 'signedIn' | 'member' | 'pending' | 'technical';
export type GuideViewer = Record<GuideAudience, boolean>;

export interface GuideItem {
  /** 화면에 보이는 버튼·메뉴·표시 이름 */
  name: string;
  /** 하는 일 */
  what: string;
  /** 이럴 때 쓰면 좋아요 */
  tip?: string;
  show?: GuideAudience;
}

export interface GuidePart {
  title?: string;
  items: GuideItem[];
}

export interface GuideSection {
  id: string;
  title: string;
  /** 화면 어디에서 찾는지 */
  where: string;
  intro: string;
  parts: GuidePart[];
}

export interface GuideStep {
  title: string;
  text: string;
  to?: string;
}

export interface GuideFaq {
  q: string;
  a: string;
  show?: GuideAudience;
}

const levels = ko.reader.levels;
const level = (id: string) => levels[id]!;
const stages = ko.start.stages;

export const guideSteps: GuideStep[] = [
  { title: '설명 난이도 고르기', text: `처음 들어오면 “${ko.reader.setupTitle}”가 나와요. 읽기 편한 수준을 고르면 AI가 모든 설명을 그 말투로 써요. 나중에 오른쪽 위 톱니바퀴에서 언제든 바꿀 수 있어요.` },
  { title: '시작하기에서 지금 단계 고르기', text: '아이디어만 있어도, 이미 만든 코드가 있어도 괜찮아요. 단계를 고르면 다음에 할 일과 AI 코딩 도구에 붙여 넣을 첫 요청을 만들어 드려요.', to: '/' },
  { title: '내 프로젝트에서 대화 기록 열기', text: 'AI 코딩 도구를 실행했던 폴더가 프로젝트로 보여요. 프로젝트 › 세션(대화 한 번) 순서로 들어가세요.', to: '/accounts' },
  { title: '세션 분석 시작하기', text: `세션을 열고 ‘${ko.aiUnified.run}’을 누르면 이번 대화에서 한 작업, 알아 두면 좋은 개념, 보안 주의사항을 문서로 정리해요.` },
  { title: '궁금한 건 묻고, 문제로 확인하기', text: '오른쪽 도움 패널에서 질문하고 짧은 문제를 풀어 보세요. 맞힌 개념이 내 지식에 쌓여요.' },
  { title: '레포 위키로 프로젝트 전체 보기', text: `프로젝트 화면에서 ‘${ko.repo.build}’를 누르면 프로젝트가 무엇이고 어떻게 동작하는지 한 문서로 정리해요.` },
  { title: '내 지식에서 복습하기', text: '여러 대화에서 나온 개념과 내 학습 기록을 한곳에서 다시 보고, 아직 안 풀어 본 개념을 문제로 확인해요.', to: '/knowledge' },
];

export const guideSections: GuideSection[] = [
  {
    id: 'menu',
    title: '위쪽 메뉴와 어디서나 보이는 것',
    where: '모든 화면의 맨 위',
    intro: '어느 화면에 있든 위쪽 메뉴로 바로 이동할 수 있어요.',
    parts: [
      {
        items: [
          { name: ko.start.nav, what: '지금 내 준비 단계에 맞는 다음 할 일과 AI에게 건넬 첫 요청을 보여 주는 첫 화면이에요.', tip: '무엇부터 해야 할지 막막할 때, 새 프로젝트를 시작할 때 들러 보세요.' },
          { name: ko.nav.guide, what: '지금 보고 있는 이 안내예요. 로그인한 계정에서 보이는 메뉴와 버튼만 모았어요.', tip: '버튼이 무슨 일을 하는지 헷갈리면 위의 찾기 칸에 버튼 이름을 넣어 보세요.' },
          { name: ko.nav.accounts, what: 'AI 코딩 도구로 작업했던 폴더(프로젝트) 목록이에요. 여기서 프로젝트 › 세션 순서로 들어가 대화 기록과 분석 문서를 봐요.', tip: '내가 한 작업을 다시 보고 싶을 때 가장 먼저 여는 곳이에요.' },
          { name: ko.knowledge.nav, what: '모든 대화 분석에서 나온 개념과 내가 푼 문제·질문을 모은 나만의 지식 위키예요.', tip: '복습하거나, 아직 안 풀어 본 개념을 문제로 확인하고 싶을 때 여세요.' },
          { name: ko.nav.sources, what: '이 앱이 대화 기록을 읽어 올 위치와 설명을 쓸 AI를 정해요.', tip: '대부분 기본값 그대로 쓰면 돼요. 기록이 보이지 않거나 OpenRouter 키를 바꿀 때만 열어 보세요.', show: 'installation' },
          { name: `${ko.nav.accountSelect} 선택 칸`, what: '볼 수 있는 계정 중 하나를 고르면 그 계정의 프로젝트 목록으로 바로 이동해요.', show: 'accountSelect' },
          { name: '톱니바퀴 (설정)', what: '화면 색상, 글씨 크기, 정보 밀도, 설명 난이도를 바꾸는 창을 열어요.', tip: '글씨가 작거나 설명이 너무 어렵거나 쉬우면 여기서 바꾸세요. 아래 “설정” 절에 자세히 있어요.' },
          { name: ko.login.logout, what: '이 브라우저에서 로그아웃해요. 내 학습 기록은 계정에 남아 있어 다시 로그인하면 이어서 볼 수 있어요.', show: 'signedIn' },
          { name: '경로 표시 (내 프로젝트 › …)', what: '페이지 제목 위의 “내 프로젝트 › 계정 › 프로젝트 › 세션” 줄이에요. 앞 단계를 누르면 바로 돌아가요.' },
          { name: '진행 상태 표시', what: `분석처럼 시간이 걸리는 작업은 “${ko.work.steps.join(' → ')}” 단계와 진행률을 보여 줘요. 결과 저장까지 끝나야 100%가 돼요.`, tip: `AI 작성은 보통 1~3분 걸려요. 멈추고 싶으면 옆의 ‘${ko.repo.cancel}’를 누르세요.` },
        ],
      },
    ],
  },
  {
    id: 'start',
    title: ko.start.nav,
    where: `위쪽 메뉴 ‘${ko.start.nav}’ (로그인하면 처음 보이는 화면)`,
    intro: '지금 어디까지 생각해 두었는지 알려 주면, 그 단계에 맞는 다음 할 일과 AI에게 보낼 첫 요청을 만들어 드려요.',
    parts: [
      {
        title: '내 단계 알려 주기',
        items: [
          { name: '준비 단계 카드 (01~04)', what: `“${stages.idea.title}”, “${stages.direction.title}”, “${stages.features.title}”, “${stages.repository.title}” 중 지금 내 상황과 가장 가까운 것을 하나 골라요.`, tip: '딱 맞지 않아도 괜찮아요. 가장 가까운 걸 고르고 나중에 바꾸면 돼요.' },
          { name: ko.start.goal, what: '무엇을 만들고 싶은지, 어떤 불편을 해결하고 싶은지 자유롭게 적어요. 첫 요청에 함께 들어가요.', tip: '“매주 수업 자료 찾는 시간을 줄이고 싶어요”처럼 한 문장이면 충분해요. 비워 둬도 돼요.' },
          { name: ko.start.features, what: `“${stages.features.title}”나 “${stages.repository.title}”를 고르면 나와요. 생각해 둔 기능을 적어요.` },
          { name: ko.start.repository, what: `“${stages.repository.title}”를 고르면 나와요. 안내에 참고만 하고, 주소를 넣어도 저장소를 내려받거나 실행하지 않아요.` },
          { name: ko.start.submit, what: '고른 단계와 적은 내용을 저장하고, 단계별 할 일 목록과 첫 요청을 보여 줘요.' },
        ],
      },
      {
        title: '내 시작점 화면',
        items: [
          { name: '할 일 목록', what: '지금 단계에서 해 볼 일을 작은 순서로 보여 줘요.', tip: '한 번에 다 하려 하지 말고 1번부터 하나씩 해 보세요.' },
          { name: ko.start.copy, what: 'AI 코딩 도구(Claude Code, Codex 등)에 붙여 넣을 첫 요청 문장을 복사해요. 바로 코드를 만들기보다 먼저 질문하거나 읽어 보도록 쓰여 있어요.', tip: '복사한 뒤 AI 코딩 도구 대화창에 그대로 붙여 넣으세요.' },
          { name: `${ko.start.openRecords} / ${ko.start.openRepository}`, what: '내 프로젝트 화면으로 이동해요.', tip: 'AI 코딩 도구로 작업을 한 번 한 뒤 눌러 보면 그 대화가 세션으로 보여요.' },
          { name: ko.start.edit, what: '고른 단계와 적은 내용을 다시 고쳐요.', tip: '아이디어가 정해졌거나 저장소를 만들었다면 다음 단계로 바꿔 보세요.' },
          { name: ko.guide.fromStartLink, what: '시작 안내 맨 아래에 있어요. 지금 보고 있는 이 사용 방법을 열어요.', tip: '시작 안내를 따라 해 본 뒤 화면의 버튼이 궁금해지면 눌러 보세요.' },
        ],
      },
      {
        title: '이럴 때만 보여요',
        items: [
          { name: ko.start.checkApproval, what: '“AI 사용 승인 대기 중”이라고 보이면 아직 AI 설명을 쓸 수 없는 상태예요. 승인이 났는지 다시 확인해요.', tip: '승인 전에도 시작 안내를 저장하고 대화 기록과 작업 기록은 볼 수 있어요.', show: 'pending' },
          { name: ko.openRouterKey.save, what: `내 노트북에서 실행 중이고 AI 키가 아직 없을 때 “${ko.openRouterKey.startTitle}” 칸이 보여요. 관리자가 준 키가 있으면 그 키를, 받지 못했다면 본인이 발급한 키를 붙여 넣고 저장해요.`, tip: `저장한 키는 화면에 다시 보여 주지 않아요. 바꾸거나 지우려면 ${ko.nav.sources}의 “${ko.sources.llmTitle}”에서 하세요.`, show: 'ownKey' },
        ],
      },
    ],
  },
  {
    id: 'projects',
    title: ko.nav.accounts,
    where: `위쪽 메뉴 ‘${ko.nav.accounts}’`,
    intro: 'AI 코딩 도구를 실행했던 작업 폴더 하나가 프로젝트 하나예요. 같은 폴더에서 여러 도구를 썼다면 한 프로젝트로 모아 보여 줘요.',
    parts: [
      {
        items: [
          { name: '계정 카드', what: '볼 수 있는 계정마다 카드가 하나씩 있어요. 누르면 그 계정의 프로젝트 목록이 열려요. “권한 없음” 계정은 열 수 없어요.', show: 'accountCards' },
          { name: '프로젝트 목록', what: '프로젝트 이름, 폴더 경로, 사용한 도구, 세션 수, 마지막 활동 시각을 보여 줘요. 이름을 누르면 프로젝트 화면이 열려요.', tip: '최근에 작업한 프로젝트를 찾을 땐 ‘마지막 활동’을 보세요.' },
          { name: ko.projects.folderMissing, what: '기록은 남아 있지만 그 폴더가 지금은 없을 때 붙어요. 대화 기록은 그대로 볼 수 있어요.' },
          { name: ko.projects.summaryTitle, what: `모든 프로젝트의 세션 수, 내 메시지 수, 만들고 고친 파일 수, 설치한 패키지, 커밋 수를 합쳐 보여 줘요. ‘${ko.projects.topConcepts}’도 함께 보여요.`, tip: '그동안 얼마나 만들었는지 한눈에 보고 싶을 때 좋아요.' },
        ],
      },
    ],
  },
  {
    id: 'project',
    title: '프로젝트 화면',
    where: `${ko.nav.accounts} › 프로젝트 이름`,
    intro: '프로젝트 하나를 세 개의 탭으로 살펴봐요.',
    parts: [
      {
        items: [
          { name: ko.repo.tab, what: '이 프로젝트가 무엇이고 어떻게 동작하는지 AI가 코드와 대화 기록을 읽고 정리한 문서예요. 아래 “레포 위키” 절에 자세히 있어요.' },
          { name: ko.repo.sessionsTab, what: '이 프로젝트에서 AI 코딩 도구와 나눈 대화 목록이에요. 대화 한 번이 세션 하나예요. 시작 시각, 길이, 내 메시지 수, AI가 실행한 작업 수, 모델을 보여 줘요.', tip: `제목을 눌러 세션을 열고 ‘${ko.aiUnified.run}’을 눌러 보세요.` },
          { name: ko.repo.knowledgeTab, what: '이 프로젝트의 대화에서 나온 개념과 내 학습 기록만 모아 보여 줘요. 카드 사용법은 “내 지식” 절과 같아요.' },
          { name: ko.analysis.documents, what: `레포 위키 탭 맨 위에 있어요. 이 프로젝트에서 분석한 대화 문서를 목록으로 모았어요. 문서 제목이나 ‘${Object.values(ko.analysis.sections).join('·')}’을 누르면 그 부분으로 바로 가요.`, tip: `“${ko.analysis.partial}”나 “${ko.analysis.stale}”가 보이면 그 세션을 열어 다시 분석해 보세요.` },
          { name: ko.analysis.browseSessions, what: '세션 목록 탭으로 이동해요. 아직 분석한 문서가 없을 때 여기서 시작하면 돼요.' },
        ],
      },
    ],
  },
  {
    id: 'repo',
    title: '레포 위키 (프로젝트 안내)',
    where: `프로젝트 화면 › ${ko.repo.tab} 탭`,
    intro: '프로젝트 폴더의 코드와 이 프로젝트의 대화 기록을 바탕으로, 처음 보는 사람도 프로젝트를 이해할 수 있게 정리한 문서예요. 명령·파일·API·데이터베이스 표는 저장소에 적힌 그대로 가져오고, 설명 문장은 AI가 써요. 저장소는 읽기만 하고 .env 같은 비밀 파일은 열지 않아요.',
    parts: [
      {
        title: '만들고 고치기',
        items: [
          { name: ko.repo.build, what: '레포 위키를 처음 만들어요. 누가 읽을 문서인지(설명 난이도)를 고르면 그 수준에 맞춰 AI가 문장을 써요. 저장소 크기에 따라 1~3분 걸려요.', tip: '프로젝트를 처음 열었을 때, 다른 사람에게 프로젝트를 소개해야 할 때 먼저 만들어 보세요.' },
          { name: ko.repo.update, what: '레포 위키를 만든 뒤 새 대화나 파일 변경이 생겼을 때 반영해요. 바뀐 것이 있으면 “만든 뒤 바뀐 것이 있습니다”라고 알려 줘요.', tip: '작업을 한참 더 했다면 눌러서 최신 상태로 맞추세요.' },
          { name: `${ko.repo.rewrite} / ${ko.repo.rewriteWithAi}`, what: `같은 자료로 AI 문장을 새로 써요. AI 설명을 아직 쓰지 못했다면 ‘${ko.repo.rewriteWithAi}’로 보여요.`, tip: '설명이 어색하거나 실패 안내가 보이면 눌러 보세요.' },
          { name: ko.repo.cancel, what: '진행 중인 작성을 멈춰요.' },
          { name: ko.repo.preview, what: 'AI에게 실제로 보내는 자료를 미리 펼쳐 봐요. 비밀값은 가려져 있고, 펼치기만 해서는 AI를 부르지 않아요.', tip: '어떤 내용이 밖으로 나가는지 궁금하면 만들기 전에 열어 보세요.' },
        ],
      },
      {
        title: '다섯 개의 페이지',
        items: [
          { name: ko.repo.views.user!, what: `${ko.repo.viewNote.user} 주요 기능 카드도 이 페이지에 함께 있어요.`, tip: '프로젝트를 처음 보는 사람이라면 여기부터 읽으세요.' },
          { name: ko.repo.views.features!, what: '사용자가 이 프로젝트로 직접 하는 일을 기능 카드로 모았어요. 카드를 누르면 그 기능의 페이지가 열려요.', tip: '“이 기능은 어떤 파일로 되어 있지?”가 궁금할 때 좋아요. 아래 “주요 기능 페이지” 절을 보세요.' },
          { name: ko.repo.views.system!, what: ko.repo.viewNote.system!, tip: '코드를 고치기 전에 어느 파일이 무엇을 하는지 파악할 때 좋아요.' },
          { name: ko.repo.views.usage!, what: '이 프로젝트를 쓰는 사람 입장에서 화면마다 있는 버튼과 기능이 하는 일, 언제 쓰면 좋은지를 AI가 코드를 읽고 정리한 안내예요. 처음 순서, 화면별 버튼 설명, 자주 묻는 질문으로 되어 있어요. 아래 “어떻게 사용하나요?” 묶음을 보세요.', tip: '내가 만든 앱의 사용 설명서가 필요할 때, 다른 사람에게 앱 쓰는 법을 알려 줄 때 좋아요.' },
          { name: ko.repo.views.security!, what: '코드와 대화 기록에서 찾은 보안·데이터 주의사항과 확인할 방법이에요. 실제 서비스나 설치된 버전을 자동으로 검사한 결과는 아니에요.', tip: '배포하거나 다른 사람에게 공개하기 전에 한 번 읽어 보세요.' },
        ],
      },
      {
        title: ko.repo.views.usage!,
        items: [
          { name: ko.usage.analyze, what: `AI가 화면·메뉴·명령이 정의된 파일을 고르고, 필요한 코드만 읽어 가며 최대 ${REPO_USAGE_LIMITS.rounds}단계까지 버튼이 실제로 하는 일을 확인한 뒤 사용 방법을 써요. 운영자·관리자 기능은 넣지 않아요. 저장소 크기에 따라 3~6분 걸려요.`, tip: '레포 위키를 만든 뒤에 누를 수 있어요. 누르기 전에는 AI를 부르지 않아요.' },
          { name: ko.usage.reanalyze, what: '“분석한 뒤 바뀐 것이 있습니다”가 보이면 눌러서 최신 코드로 다시 써요. 설명 난이도마다 따로 저장해요.' },
          { name: ko.usage.preview, what: '분석을 시작할 때 AI에게 처음 보내는 내용을 미리 봐요. 펼치기만 해서는 AI를 부르지 않아요.' },
          { name: ko.usage.labelSame, what: '버튼 이름 아래에 붙는 표시예요. AI가 옮긴 화면 문구가 코드에 적힌 글자와 같은지 서버가 확인했다는 뜻이에요. 다르게 적혀 있으면 “…”로 실제 문구를 보여 줘요.', tip: '표시가 없는 이름은 AI가 부른 이름이라, 실제 화면과 조금 다를 수 있어요.' },
          { name: ko.usage.checked, what: 'AI가 분석하면서 스스로 던진 질문과 코드를 읽고 찾은 답, 코드로 확인하지 못한 것을 펼쳐 봐요.' },
        ],
      },
      {
        title: '읽으면서 쓰는 것',
        items: [
          { name: ko.repo.contents, what: '페이지의 절 제목 목록이에요. 누르면 그 절로 이동해요.' },
          { name: '어디서 확인했나요? · 근거', what: '설명마다 붙은 근거를 펼쳐요. 파일 이름을 누르면 그 파일의 해당 줄을 강조해서 보여 주고, 세션을 누르면 그 대화의 분석 문서로 가요.', tip: 'AI 설명이 맞는지 직접 확인하고 싶을 때 근거 파일을 열어 보세요.' },
          { name: `근거 파일 창 (${ko.source.search})`, what: `파일 원문을 줄 번호와 함께 보여 줘요. ‘${ko.source.search}’로 글자를 찾고, ‘${ko.source.previous}·${ko.source.next}’로 주변 코드를 더 읽어요. 비밀값으로 보이는 내용은 가려져 있어요.`, tip: '“위키를 작성한 뒤 파일 내용이 바뀌었습니다”가 보이면 위키를 업데이트하세요.' },
          { name: ko.source.flowTitle, what: '파일마다 하는 일을 상자로 보여 주고, 어떤 파일이 어떤 파일을 불러오는지 화살표로 이어요. 화살표는 실행 순서가 아니에요. 상자를 누르면 그 파일의 코드를 열어요.', tip: `그림이 복잡하면 ‘${ko.source.connections}’를 펼쳐 글로 보세요.` },
          { name: '데이터베이스 표', what: `‘${ko.repo.views.system}’ 페이지에 있어요. 맨 위 요약 표에서 표마다 무엇을 저장하는지, 어떤 주요 기능이 쓰는지 보여 줘요. 표 이름을 누르면 컬럼·타입·조건이 펼쳐지고, 기능 이름을 누르면 그 기능 페이지로 가요.`, tip: '“이 데이터는 어디에 저장되지?”가 궁금할 때 보세요.' },
          { name: 'API 목록 보기 · 스크립트 목록 보기 · 표 펼쳐 보기', what: '줄이 많은 표는 접혀 있어요. 눌러서 펼쳐요.' },
          { name: `${ko.repo.changes} · 업데이트 기록`, what: '업데이트하면 무엇이 달라졌는지와 지난 업데이트 기록을 펼쳐 볼 수 있어요.' },
        ],
      },
    ],
  },
  {
    id: 'feature',
    title: '주요 기능 페이지',
    where: `레포 위키 › ${ko.repo.views.features} 탭 › 기능 카드`,
    intro: '기능 하나가 어떤 파일로 이루어져 있는지, 사용자가 어떤 순서로 쓰는지, AI를 부른다면 어떤 모델과 프롬프트를 쓰는지 정리한 페이지예요.',
    parts: [
      {
        title: '분석하기',
        items: [
          { name: '기능 카드', what: `기능 이름과 짧은 설명, 관련 파일·데이터베이스 표·세션 수를 보여 줘요. “자세한 분석”이 붙은 카드는 이미 분석한 기능이고, “${ko.feature.basic}”은 아직 분석 전이에요.` },
          { name: ko.feature.analyze, what: 'AI가 확인할 질문을 직접 만들고, 필요한 코드만 읽어 가며 최대 3단계까지 확인한 뒤 페이지를 써요. 1~3분 걸려요.', tip: '기능을 고치거나 넓히기 전에, 그 기능이 어디서 어떻게 돌아가는지 알고 싶을 때 눌러 보세요.' },
          { name: ko.feature.reanalyze, what: '“분석한 뒤 바뀐 것이 있습니다”가 보이면 눌러서 최신 코드로 다시 분석해요.' },
          { name: ko.feature.preview, what: '분석을 시작할 때 AI에게 처음 보내는 내용을 미리 봐요. 펼치기만 해서는 AI를 부르지 않아요.' },
        ],
      },
      {
        title: '페이지 구성',
        items: [
          { name: ko.feature.sections.overview, what: '이 기능이 무엇을 하는지 짧게 요약해요.' },
          { name: ko.feature.sections.flow, what: '사용자가 이 기능을 쓰는 순서를 단계별로 보여 줘요.' },
          { name: ko.feature.sections.files, what: '이 기능을 이루는 파일과 각 파일의 역할이에요. 눌러서 코드를 열 수 있어요.' },
          { name: ko.feature.sections.tables, what: '이 기능이 저장하거나 읽는 데이터베이스 표와 컬럼이에요.' },
          { name: ko.feature.sections.ai, what: `이 기능이 AI를 부른다면 어떤 서비스와 모델을 쓰는지, 실제로 보내는 ${ko.feature.systemPrompt}·${ko.feature.userPrompt} 문장을 코드에서 그대로 옮겨 보여 줘요. 색이 다른 {…} 부분은 실행할 때 채워지는 값이에요. ‘${ko.feature.showCode}’를 펼치면 전체 코드를 볼 수 있어요.`, tip: '내 앱이 AI에게 무엇을 시키는지 확인하거나 프롬프트를 고치고 싶을 때 보세요.' },
          { name: ko.feature.sections.questions, what: '분석하면서 AI가 스스로 던진 질문과, 코드를 읽고 찾은 답을 단계별로 보여 줘요.' },
          { name: ko.feature.sections.limits, what: '읽은 코드만으로는 알 수 없었던 부분이에요.', tip: '이 부분은 직접 실행하거나 코드를 열어 확인해 보세요.' },
        ],
      },
    ],
  },
  {
    id: 'session',
    title: '세션 화면',
    where: `프로젝트 화면 › ${ko.repo.sessionsTab} 탭 › 세션 제목`,
    intro: '대화 한 번(세션)을 세 개의 탭으로 살펴봐요. 맨 위에는 사용한 도구, 대화 시간, 내 메시지 수, AI가 실행한 작업 수, 모델이 보여요.',
    parts: [
      {
        title: '맨 위 정보와 링크',
        items: [
          { name: ko.common.live, what: '지금도 이어지고 있는 대화예요. 대화가 계속되면 내용이 늘어나요.' },
          { name: `${ko.repo.sessionLink} →`, what: '이 세션이 속한 프로젝트의 레포 위키로 가요.' },
          { name: `${ko.analysis.knowledgeLink} →`, what: '이 프로젝트의 내 지식 화면으로 가요.' },
          { name: ko.feature.sessionLinks, what: '이 대화에서 만들거나 고친 기능의 페이지 링크예요.' },
          { name: ko.session.warnings, what: '대화 기록 파일의 일부를 읽지 못했을 때만 보여요. 나머지 내용은 그대로 볼 수 있어요.' },
        ],
      },
      {
        title: '세 개의 탭',
        items: [
          { name: ko.understand.tab, what: '이 대화에서 한 작업, 알아 두면 좋은 개념, 보안 주의사항을 정리한 분석 문서예요. 아래 “세션 분석 문서” 절에 자세히 있어요.' },
          { name: ko.session.tabs.messages, what: `내가 직접 입력한 메시지만 순서대로 보여 줘요. AI 답변, 도구 결과, 자동으로 끼워 넣어진 글은 빼요. ${ko.session.slashCommand}(/로 시작), ${ko.session.interrupted}, ${ko.session.turnDuration}, 그때 열려 있던 파일도 표시해요.`, tip: '내가 어떻게 요청했는지 돌아보면 다음에 더 좋은 요청을 쓰는 데 도움이 돼요.' },
          { name: ko.common.copyAll, what: '내 메시지 전체를 번호를 붙여 복사해요.', tip: '비슷한 작업을 다시 할 때 예전 요청을 참고하거나, 회고 글을 쓸 때 써 보세요.' },
          { name: ko.session.tabs.built, what: '요청마다 내가 요청한 내용과 에이전트가 작업 뒤에 남긴 결과 보고를 함께 보여 줘요. 마지막 보고는 펼쳐져 있고, 이전 요청은 눌러서 읽어요.' },
          { name: ko.built.openRequest, what: `그 요청을 ‘${ko.session.tabs.messages}’ 탭에서 찾아 보여 줘요.` },
          { name: ko.built.plainReport, what: '보기 좋게 정리하기 전의 보고 원문을 그대로 펼쳐요.' },
          { name: ko.built.activityTitle, what: '만들고 고치고 지운 파일, 만든 폴더, 설치한 패키지, 실행한 명령, 커밋, 띄운 서버, 사용한 기술을 모아 보여 줘요.', tip: '에이전트가 “완료했어요”라고 보고한 것과 실제로 바뀐 파일·명령을 비교해 보세요.' },
        ],
      },
    ],
  },
  {
    id: 'analysis',
    title: ko.aiUnified.title,
    where: `세션 화면 › ${ko.understand.tab} 탭`,
    intro: '코딩 에이전트와 나눈 대화를 AI가 읽고, 이번 대화에서 한 작업 · 알아 두면 좋은 개념 · 보안 주의사항을 한 문서로 정리해요. 오른쪽(좁은 화면에서는 아래)의 도움 패널과 함께 읽어요.',
    parts: [
      {
        title: '분석하기',
        items: [
          { name: ko.aiUnified.run, what: '작업 요약과 작업·개념·보안 분석을 함께 시작해요. 보통 1~3분 걸려요. 설명 난이도를 고르기 전에는 시작하지 않아요.', tip: '세션을 처음 열었다면 먼저 눌러 보세요. 자동으로 쓰기가 켜져 있으면 알아서 시작하기도 해요.' },
          { name: ko.aiUnified.rerun, what: '이미 분석한 문서를 새로 써요. “대화 기록이 바뀌었습니다”가 보이면 눌러서 최신 대화로 갱신하세요.', tip: '바뀐 게 없으면 누르지 않아도 돼요. 같은 기록·같은 설명 난이도라면 저장된 결과를 그대로 보여 줘요.' },
          { name: ko.aiUnified.cancel, what: '진행 중인 분석을 멈춰요.' },
          { name: ko.aiUnified.preview, what: 'AI에 보낼 요약을 미리 확인해요. 원본 기록 파일과 도구 출력 전체는 보내지 않고 비밀값은 가려요.', show: 'technical' },
        ],
      },
      {
        title: '문서를 읽는 순서',
        items: [
          { name: `${ko.reading.path} (1~5)`, what: `문서 맨 위의 번호 목차예요. ${[ko.reading.summary, ko.reading.wiki, ko.reading.concepts, ko.reading.knowledge, ko.reading.security].join(' → ')} 순서이고, 누르면 그 절로 이동해요.` },
          { name: ko.understand.summary, what: `요청한 작업과 결과를 짧게 요약하고, 목표 달성 정도(${Object.values(ko.enrich.outcome).join('·')}), ${ko.enrich.features}, ${ko.enrich.nextSteps}을 보여 줘요.`, tip: `‘${ko.enrich.nextSteps}’은 다음 대화의 첫 요청으로 쓰기 좋아요.` },
          { name: ko.understand.wiki, what: `이번 작업에서 바뀐 것과 그 이유를 설명 카드로 정리해요. ‘${ko.wiki.alerts}’, ‘${ko.wiki.items}’, ‘${ko.wiki.deferred}’ 순서로 이어져요.` },
          { name: ko.wiki.alerts, what: '위험하거나 꼭 확인해야 할 항목이에요. 내 이해 수준과 관계없이 모든 사람에게 똑같이 보여요.', tip: '이 부분은 건너뛰지 말고 꼭 읽어 보세요.' },
          { name: `${ko.wiki.showDeferred} (${ko.wiki.deferred})`, what: '첫 화면에 넣지 않은 나머지 설명을 펼쳐요.' },
          { name: '근거 표시 (기록에서 확인 · AI의 설명 · 추정)', what: `카드의 내용이 어디서 왔는지 알려 줘요. “${ko.wiki.claimKind.observed_artifact}”은 실제 기록에 남은 사실, “${ko.wiki.claimKind.agent_reported}”는 에이전트가 말한 것, “${ko.wiki.claimKind.inference}”은 AI가 기록을 보고 짐작한 것이에요.`, tip: '“AI의 설명”이나 “추정”이 붙은 내용은 직접 한 번 더 확인해 보세요.' },
          { name: ko.wiki.jump, what: '그 근거가 된 내 메시지로 바로 이동해요.' },
          { name: ko.understand.concepts, what: `이번 작업을 이해하는 데 필요한 개념 카드예요. 정의, ${ko.concepts.whyHere}, 예시, ${ko.concepts.links} 링크가 있어요. ‘${ko.concepts.level.beginner}·${ko.concepts.level.intermediate}’ 표시로 난이도를, ‘${ko.concepts.mentionOnly}’으로 대화에서 이야기만 나온 개념을 알 수 있어요.` },
          { name: `${ko.concepts.relatedRecords} · ${ko.concepts.openMessage}`, what: '이 개념이 나온 대화 부분을 펼치고, 해당 메시지로 이동해요.' },
          { name: ko.wiki.coverage, what: `이번 분석에서 ${Object.values(ko.wiki.coverageKeys).join(', ')}을 어디까지 볼 수 있었는지 보여 줘요.`, tip: '“없음”인 자료는 분석에 들어가지 않았다는 뜻이에요. 그 부분에 대한 결론은 조심해서 읽으세요.' },
          { name: ko.knowledge.sessionTitle, what: '이 대화에서 나온 개념의 내 학습 상태와 문제 풀기 버튼이에요. 사용법은 “내 지식” 절과 같아요.' },
          { name: ko.security.title, what: '이번 기록에서 찾은 보안·데이터 주의사항과 근거, 확인 방법이에요. 대화 기록을 근거로 한 점검이라, 실제 서비스나 설치된 버전의 취약점을 자동으로 검사한 결과는 아니에요.', tip: '“찾지 못했습니다”가 안전하다는 뜻은 아니에요. 비밀번호·키·개인정보를 다뤘다면 직접 한 번 더 살펴보세요.' },
        ],
      },
      {
        title: '설명 카드의 버튼',
        items: [
          { name: ko.wiki.whatsThis, what: '카드에 나온 용어의 뜻을 바로 아래에 펼쳐요.' },
          { name: ko.wiki.simpler, what: '설명을 기본 깊이로 낮추고, 먼저 알아야 할 개념과 예시를 함께 보여 줘요.', tip: '설명이 어렵게 느껴지면 가장 먼저 눌러 보세요.' },
          { name: ko.wiki.deeper, what: `한 단계 더 깊은 설명을 보여 줘요 (${Object.values(ko.wiki.depth).join(' → ')}).` },
          { name: ko.wiki.example, what: '예시를 켜고 꺼요. 고른 설명 깊이와 예시는 그 개념의 내 설명 방식으로 기억해 다음에도 이어져요.' },
          { name: ko.understanding.known, what: `바로 기록하지 않고 OX 문제 하나를 내요. 맞히면 ‘${ko.understanding.known}’로 기록하고 다음 설명을 짧게 보여 줘요.` },
          { name: ko.understanding.unsure, what: '이 개념이 아직 낯설다고 알려요. 다음 설명은 먼저 알아야 할 개념과 함께 더 자세히 보여 줘요. 틀린 것으로 세지 않아요.' },
          { name: ko.understanding.quiz, what: '이 개념의 짧은 문제를 내요. 도움 패널의 퀴즈 탭에서 열려요.' },
          { name: ko.help.askAbout, what: '오른쪽 도움 패널의 질문 탭을 이 카드에 맞춰 열어요.' },
          { name: ko.understanding.later, what: '확인 버튼 줄을 이번에는 닫아요. 아무것도 기록하지 않아요.' },
        ],
      },
    ],
  },
  {
    id: 'help',
    title: `도움 패널 (${ko.help.title})`,
    where: '세션 분석 문서의 오른쪽 (좁은 화면에서는 화면 아래 서랍)',
    intro: '분석 문서에서 개념·설명 카드·확인할 사항·파일을 누르면, 그 대상에 맞춰 설명을 보여 주고 질문과 문제 풀이를 도와주는 패널이에요. 패널 제목 옆에 지금 보고 있는 대상이 표시돼요.',
    parts: [
      {
        items: [
          { name: `${ko.help.title} (패널 제목)`, what: '좁은 화면에서는 이 제목을 눌러 패널을 열고 닫아요.' },
          { name: ko.help.reset, what: '특정 개념이 아니라 이 세션 전체를 대상으로 되돌려요.' },
          { name: ko.help.tabs.explain!, what: `고른 개념의 설명을 보여 줘요. ‘${Object.values(ko.wiki.depth).join('·')}’로 설명 깊이를 바꾸고 ‘${ko.wiki.example}’로 예시를 켤 수 있어요. 이 세션에서 어떻게 쓰였는지와 관련 작업 설명도 함께 보여 줘요.`, tip: '처음엔 ‘기본’으로 읽고, 어려우면 ‘짧게’, 더 알고 싶으면 ‘자세히’로 바꿔 보세요.' },
          { name: ko.help.tabs.ask!, what: '지금 대상에 대해 AI에게 자유롭게 물어봐요. 답은 이 세션의 기록을 근거로 써요. 보통 10~60초 걸려요.', tip: 'Ctrl+Enter로 바로 보낼 수 있어요. 질문을 많이 해도 이해 상태가 내려가지 않으니 편하게 물어보세요.' },
          { name: ko.help.examples, what: '지금 대상에 맞는 질문 예시예요. 누르면 바로 질문해요.', tip: '무엇을 물어야 할지 모르겠다면 예시부터 눌러 보세요.' },
          { name: `${ko.help.ask} · ${ko.help.cancel} · ${ko.help.retry}`, what: '질문을 보내고, 답을 만드는 중이면 멈추고, 실패했으면 다시 보내요.' },
          { name: ko.help.followUps, what: '답 아래에 AI가 제안한 다음 질문이에요. 누르면 같은 대화를 이어서 물어봐요.' },
          { name: '답의 구성', what: `답은 “${ko.help.connection}”, “${ko.help.general}”, “${ko.help.unverified}”으로 나눠 보여 줘요. 기록에서 근거를 확인한 내용만 이번 프로젝트와 연결해요.`, tip: '“기록으로 확인되지 않은 것”은 직접 확인이 필요한 부분이에요.' },
          { name: ko.help.recalled, what: '답을 쓸 때 참고한 예전 질문·문제 기록을 펼쳐 볼 수 있어요.' },
          { name: ko.help.tabs.quiz!, what: `고른 개념의 짧은 문제를 풀어요. 세션 전체를 보고 있으면 ‘${ko.help.quizSuggested}’ 목록을 보여 줘요.`, tip: '이 패널에서 질문한 개념의 문제는 도움을 받은 응답이라 연습으로 기록돼요. 내 지식에 반영하고 싶다면 질문하기 전에 먼저 풀어 보세요.' },
        ],
      },
    ],
  },
  {
    id: 'quiz',
    title: '문제 풀기 (퀴즈)',
    where: `개념 카드의 ‘${ko.knowledge.quiz}’·‘${ko.understanding.quiz}’, 도움 패널의 ${ko.help.tabs.quiz} 탭`,
    intro: '짧은 객관식이나 OX 문제로 개념을 확인해요. AI가 내 학습 기록에 맞춰 문제를 만들고, 정답과 해설은 내가 답을 낸 뒤에만 보여 줘요. 모르겠거나 건너뛰어도 괜찮아요.',
    parts: [
      {
        items: [
          { name: `답 고르기 (${ko.quiz.format.single_choice} · ${ko.quiz.format.true_false})`, what: '보기 중 하나를 고르거나, 문장이 맞는지 아닌지 골라요.' },
          { name: ko.quiz.showReason, what: '왜 그렇게 생각했는지 적어요. 적지 않아도 돼요.' },
          { name: ko.quiz.submit, what: '답을 내고 채점 결과와 해설을 봐요.' },
          { name: ko.quiz.dontKnow, what: '답을 모를 때 눌러요. 틀린 것으로 세지 않고 정답과 해설을 보여 줘요.' },
          { name: ko.quiz.skip, what: '이 문제를 넘겨요. 틀린 것으로 세지 않아요.' },
          { name: ko.quiz.another, what: '같은 개념의 새 문제를 받아요. 이미 푼 문제와 겹치지 않게 만들어요.' },
          { name: '결과 표시', what: `“${ko.quiz.correct}”·“${ko.quiz.incorrect}” 아래에 “${ko.quiz.counted}” 또는 “${ko.quiz.practice}” 표시가 붙어요. 처음 보는 문제를 도움 없이 풀었을 때만 내 지식 상태에 반영되고, 해설을 본 뒤 다시 푼 문제나 이미 푼 문제는 연습으로 남아요.`, tip: '연습도 맞힌 횟수와 다음 설명에 쓰여요. 부담 없이 여러 번 풀어 보세요.' },
          { name: ko.quiz.candidate, what: 'AI가 새로 만든 문제라는 표시예요. 처음 풀 때 도움 없이 맞히면 내 지식에 반영돼요.' },
          { name: `${ko.quiz.report} (${ko.quiz.reportTitle})`, what: `답을 확인한 뒤 문제 카드 오른쪽 위에 보여요. ${Object.values(ko.quiz.reportReasons).join(', ')} 중 사유를 고르고 ‘${ko.quiz.reportSubmit}’를 누르면 한 번 더 확인한 뒤 보내요.`, tip: '신고한 문제의 결과는 내 지식에 반영하지 않고, 다음 문제를 만들 때 참고해요. 보낸 뒤에는 되돌릴 수 없어요.' },
          { name: `‘${ko.knowledge.known}’ 확인 (OX 하나)`, what: `‘${ko.knowledge.known}’를 누르면 “${ko.quiz.selfCheckTitle}”가 나와요. 맞히면 알고 있다고 기록하고, 틀리거나 건너뛰면 기록하지 않아요.` },
        ],
      },
    ],
  },
  {
    id: 'knowledge',
    title: ko.knowledge.title,
    where: `위쪽 메뉴 ‘${ko.knowledge.nav}’ (프로젝트·세션 화면에도 같은 카드가 있어요)`,
    intro: '대화 분석에서 나온 개념과 내 학습 기록을 모은 나만의 지식 위키예요. 다른 사람에게는 보이지 않아요. 대화에서 언급한 것만으로는 상태가 바뀌지 않고, 짧은 문제를 풀어 맞히면 쌓여요.',
    parts: [
      {
        title: '위쪽',
        items: [
          { name: ko.knowledge.dashboard.title, what: `${ko.knowledge.dashboard.learned}(문제로 확인·익히는 중), ${ko.knowledge.dashboard.solved} 수, ${ko.knowledge.dashboard.untried} 수와 진행 막대를 보여 줘요. 틀린 문제 수는 세지 않아요.`, tip: `‘${ko.knowledge.dashboard.untried}’이 있다면 그 카드의 ‘${ko.knowledge.quiz}’부터 해 보세요.` },
          { name: `${ko.common.projects} 선택 칸 (${ko.knowledge.allProjects})`, what: '프로젝트가 둘 이상이면 보여요. 한 프로젝트의 개념만 골라 봐요.' },
          { name: ko.analysis.projectLink, what: '보고 있는 프로젝트의 레포 위키로 가는 링크예요.' },
        ],
      },
      {
        title: '개념 카드 묶음',
        items: [
          { name: ko.knowledge.groups.check!, what: `작업 설명에 직접 나왔거나 ‘${ko.knowledge.state.conflicting}’·‘${ko.knowledge.disputed}’인 개념이에요.`, tip: '먼저 문제로 확인해 보면 좋은 개념들이에요.' },
          { name: ko.knowledge.groups.confirmed!, what: '문제를 맞혀서 익히고 있거나 확인한 개념이에요.' },
          { name: ko.knowledge.groups.background!, what: '대화에서 함께 나온 배경 개념이에요. 처음에는 접혀 있어요.' },
        ],
      },
      {
        title: '카드의 버튼',
        items: [
          { name: ko.knowledge.quiz, what: '이 개념의 짧은 문제를 풀어요. 맞힌 문제가 여기에 쌓여요.', tip: '가장 추천하는 버튼이에요. 생각날 때마다 몇 개씩 풀어 보세요.' },
          { name: ko.knowledge.known, what: `OX 문제 하나로 확인해요. 맞히면 ‘${ko.knowledge.known}’로 기록돼요.` },
          { name: ko.knowledge.explain, what: '이 개념의 설명을 펼쳐요. 세션 분석 화면에서는 도움 패널의 설명 탭에서 열려요.' },
          { name: ko.help.askAbout, what: '이 개념이 나온 대화의 분석 문서로 가서 도움 패널의 질문 탭을 열어 줘요. 세션 분석 화면에서는 바로 패널이 열려요.' },
          { name: ko.knowledge.unsure, what: '잘 모른다고 알리고 설명을 펼쳐요. 다음 설명이 더 자세해져요.' },
          { name: ko.knowledge.wrong, what: `‘${ko.knowledge.state.partial}’이나 ‘${ko.knowledge.state.demonstrated}’ 카드에 보여요. 찍어서 맞혔거나 아직 헷갈리면 눌러서 어떤 부분이 헷갈리는지 적어 보내요. 카드가 ‘${ko.knowledge.disputed}’으로 바뀌고 다음 설명이 더 자세해져요.`, tip: '솔직하게 알려 줄수록 나에게 맞는 설명을 받을 수 있어요. 새 문제를 풀면 다시 반영돼요.' },
          { name: `${ko.knowledge.writeAi} · ${ko.knowledge.retryText}`, what: '아직 AI 설명이 없거나 쓰지 못한 카드가 있을 때 보여요. 눌러서 설명을 써요.' },
          { name: `근거 · ${ko.analysis.related}`, what: '이 개념이 나온 분석 문서로 이동해요. 출처가 많으면 ‘관련 분석 문서 더 보기’로 펼쳐요.' },
          { name: '대화에서 언급', what: '내 메시지에서 이 개념을 이야기한 부분이에요. 참고용이고 상태를 바꾸지 않아요.' },
          { name: '학습 기록 줄', what: `카드 아래에 내 상태, 맞힌 횟수, ‘${ko.learning.recent}’, ‘${ko.learning.next}’(다음 설명을 어떻게 맞출지)을 보여 줘요.` },
        ],
      },
      {
        title: '상태 배지',
        items: [
          { name: '(배지 없음)', what: '아직 문제로 확인하지 않은 개념이에요. 모른다는 뜻이 아니에요.' },
          { name: ko.knowledge.state.partial!, what: `고르기 문제 1개, 또는 서로 다른 문제 2개를 맞혔거나, ‘${ko.knowledge.known}’ OX 확인을 처음에 도움 없이 맞혔어요.` },
          { name: ko.knowledge.state.demonstrated!, what: '서로 다른 문제 2개 이상을 맞혔고, 그중 배운 내용을 적용하는 고르기 문제가 있어요.' },
          { name: ko.knowledge.state.conflicting!, what: '맞힌 문제와 틀린 문제가 섞여 있어요. 마지막으로 틀린 뒤 다시 맞히면 올라가요.' },
          { name: ko.knowledge.disputed, what: `‘${ko.knowledge.wrong}’를 눌렀어요. 다음 설명이 더 자세해져요.` },
          { name: ko.learning.progress.improving!, what: '틀렸던 개념을 다시 맞혔어요.' },
          { name: ko.knowledge.selfReport.known!, what: 'OX 확인 문제를 맞혀서 알고 있다고 기록된 개념이에요.' },
        ],
      },
      {
        title: ko.memory.title,
        items: [
          { name: ko.memory.title, what: `눌러서 펼치면 ${ko.memory.intro}` },
          { name: ko.memory.search, what: `‘${ko.memory.placeholder.replace(/^예: /, '')}’처럼 낱말을 넣고 찾으면 맞는 질문과 문제만 걸러 보여 줘요. AI를 부르지 않아요.` },
          { name: `${ko.memory.questionsTitle} · ${ko.memory.showAnswer}`, what: `내가 한 질문 목록이에요. ‘${ko.memory.showAnswer}’로 그때 받은 답을 펼치고, 세션 제목을 눌러 원래 분석 문서로 가요.` },
          { name: `${ko.memory.solvedTitle} · ${ko.memory.showSolution}`, what: `답을 확인한 문제 목록이에요. 맞힌 문제에는 ‘${ko.memory.solvedMark}’ 표시가 붙어요. ‘${ko.memory.showSolution}’로 다시 복습해요.` },
        ],
      },
    ],
  },
  {
    id: 'settings',
    title: '설정 (톱니바퀴)',
    where: '모든 화면 오른쪽 위의 톱니바퀴',
    intro: '화면 보기 방식과 설명 난이도를 바꿔요. 화면 설정은 이 브라우저에만 저장되고 바로 적용돼요.',
    parts: [
      {
        title: ko.settings.appearance,
        items: [
          { name: ko.theme.label, what: `“${ko.theme.system}”, “${ko.theme.light}”, “${ko.theme.dark}” 중에서 골라요.` },
          { name: ko.settings.fontSize, what: '설명 글씨 크기를 13~18px 중에서 골라요. 기본은 14px이에요.' },
          { name: ko.settings.codeSize, what: '코드 글씨 크기를 11~16px 중에서 골라요. 기본은 12px이에요.' },
          { name: ko.settings.density, what: `‘${ko.settings.compact}’는 한 화면에 더 많이, ‘${ko.settings.comfortable}’는 간격을 넓혀 보여 줘요.` },
          { name: ko.settings.reset, what: '글씨와 화면 설정을 처음 상태로 되돌려요.' },
        ],
      },
      {
        title: ko.reader.title,
        items: [
          { name: ko.reader.title, what: 'AI가 쓰는 말투와 설명 깊이를 정해요. 바꾸면 그 수준으로 다시 쓰고, 이미 쓴 수준의 글은 저장돼 있어 다시 기다리지 않아요. 내 이해 상태나 위험 알림에는 영향을 주지 않아요.', tip: '글이 어렵게 느껴지면 한 단계 쉬운 수준으로, 너무 길면 한 단계 위 수준으로 바꿔 보세요.' },
          ...['non-dev', 'beginner', 'junior', 'senior'].map((id) => ({
            name: level(id).label,
            what: `${level(id).desc}${id === 'junior' || id === 'senior' ? ' 이 수준을 고르면 걸린 시간, 보낼 내용 미리 보기 같은 기술 정보도 함께 보여요.' : ''}`,
            tip: `${ko.reader.example}: ${level(id).example}`,
          })),
        ],
      },
    ],
  },
];

export const guideFaq: GuideFaq[] = [
  { q: '분석하면 내 코드나 대화가 그대로 밖으로 나가나요?', a: `원본 대화 기록 파일과 도구 출력 전체는 보내지 않아요. 내 메시지 요약, 파일·명령 목록, 필요한 코드 일부처럼 정리한 내용만 AI에 보내고, 비밀번호·키처럼 보이는 값은 가려요. ‘${ko.repo.preview}’에서 직접 확인할 수 있어요.` },
  { q: '이 앱이 내 코드나 기록을 바꾸나요?', a: '아니요. 대화 기록과 프로젝트 폴더는 읽기만 하고, 코드나 명령을 실행하지도 않아요. 분석 결과는 앱의 저장소에 따로 저장해요.' },
  { q: '같은 분석을 다시 열면 또 기다려야 하나요?', a: '아니요. 한 번 쓴 결과는 저장해 두고, 같은 기록·같은 설명 난이도라면 그대로 보여 줘요. 대화가 늘었거나 파일이 바뀌었다는 안내가 보일 때만 다시 분석하거나 업데이트하세요.' },
  { q: '틀리거나 ‘모르겠어요’를 누르면 불리한가요?', a: `‘${ko.quiz.dontKnow}’, ‘${ko.quiz.skip}’, 질문하기는 틀린 것으로 세지 않아요. 틀린 문제 수는 화면에 세지 않고 다음 설명을 나에게 맞추는 데 써요. 맞힌 문제와 틀린 문제가 섞이면 ‘${ko.knowledge.state.conflicting}’으로 보이지만, 다시 맞히면 올라가요.` },
  { q: '“AI 사용 승인 대기 중”이라고 나와요.', a: `AI 사용이 승인되어야 AI 설명을 쓸 수 있어요. 그동안에도 대화 기록과 작업 기록은 볼 수 있어요. 승인 소식을 들었다면 ${ko.start.nav} 화면의 ‘${ko.start.checkApproval}’을 누르세요.`, show: 'pending' },
  { q: '분석이나 위키 작성이 실패했어요.', a: `실패 이유가 화면에 함께 나와요. 잠시 뒤 ‘${ko.aiUnified.rerun}’나 ‘${ko.repo.rewrite}’를 눌러 보세요. AI를 쓸 수 없는 상태라면 그 이유를 알려 주고, 정해진 설명으로 대신 채우지 않아요.` },
  { q: `‘${ko.nav.accounts}’에 아무것도 보이지 않아요.`, a: `${Object.values(ko.provider).join(', ')} 같은 AI 코딩 도구로 이 기기(또는 접속한 서버 계정)에서 작업한 기록이 있어야 보여요. AI 코딩 도구로 작업을 한 번 한 뒤 다시 열어 보세요.` },
  { q: '내 학습 기록은 누가 볼 수 있나요?', a: '내 지식, 내가 한 질문, 풀어 본 문제는 다른 회원에게 보이지 않아요. 같은 계정으로 로그인하면 다른 기기에서도 이어서 볼 수 있어요.', show: 'member' },
];
