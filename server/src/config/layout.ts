import fs from 'node:fs';
import path from 'node:path';

/** 저장소에서 tsx 로 실행할 때와 배포 묶음(app/server.mjs)으로 실행할 때 읽을 파일 위치 */
export interface ServerLayout {
  /** 배포 묶음 안에서 실행 중인지. 이때만 브라우저를 자동으로 연다 */
  packaged: boolean;
  /** 앞의 파일이 우선한다 (셸 환경변수는 항상 가장 우선) */
  envFiles: string[];
  distDir: string;
}

/** 배포 묶음의 공개 설정 파일 이름. `npm run package` 가 app/ 에 만든다 */
export const RELEASE_ENV_FILE = 'release.env';

/**
 * `here` 는 실행 중인 서버 코드가 있는 폴더다. 저장소에서는 server/src, 배포 묶음에서는 app/ 이다.
 * 배포 묶음은 관리자용 `.env.admin` 을 읽지 않는다. 사용자가 묶음 폴더에 둔 `.env` 는 공개 설정보다 우선한다.
 */
export function resolveLayout(here: string, exists: (file: string) => boolean = fs.existsSync): ServerLayout {
  const release = path.join(here, RELEASE_ENV_FILE);
  if (exists(release)) {
    return { packaged: true, envFiles: [path.join(here, '..', '.env'), release], distDir: path.join(here, 'web') };
  }
  const root = path.resolve(here, '../..');
  return { packaged: false, envFiles: [path.join(root, '.env'), path.join(root, '.env.admin')], distDir: path.join(root, 'web', 'dist') };
}
