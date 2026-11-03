import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from '../server/src/config/dotenv';
import { MemoryDatabase, MemoryDatabaseError, checkMemoryDatabase, memoryDatabaseSettings, memoryDatabaseError } from '../server/src/memory/database';

loadDotEnv(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'));
loadDotEnv(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.admin'));
try {
  const settings = memoryDatabaseSettings();
  if (!settings) throw new MemoryDatabaseError('VIBE_TEACHER_SUPABASE_DATABASE_URL 또는 VIBE_TEACHER_MEMORY_DATABASE_URL을 설정해 주세요.');
  const result = await checkMemoryDatabase(new MemoryDatabase(settings));
  console.log('[memory-db] 연결·쓰기·벡터 검색 검사 완료');
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(`[memory-db] ${memoryDatabaseError(error)}`);
  process.exitCode = 1;
}
