import fs from 'node:fs';

/**
 * 저장소 루트의 .env 를 process.env 로 읽는다 (Node 20.12+ 의 process.loadEnvFile).
 * 이미 셸에 설정된 환경변수가 우선하며, 파일이 없으면 아무것도 하지 않는다.
 * 값은 로그에 남기지 않고 새로 들어온 키 이름만 돌려준다.
 */
export function loadDotEnv(file: string, env: NodeJS.ProcessEnv = process.env): { loaded: boolean; keys: string[] } {
  if (!fs.existsSync(file)) return { loaded: false, keys: [] };
  const load = (process as { loadEnvFile?: (path: string) => void }).loadEnvFile;
  if (typeof load !== 'function') {
    console.warn(`[vibe-teacher] 이 Node 버전(${process.version})은 .env 읽기를 지원하지 않습니다. Node 20.12 이상을 쓰거나 환경변수로 직접 설정하세요.`);
    return { loaded: false, keys: [] };
  }
  const before = new Set(Object.keys(env));
  load(file);
  return { loaded: true, keys: Object.keys(env).filter((k) => !before.has(k)) };
}
