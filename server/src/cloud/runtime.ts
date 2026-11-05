import path from 'node:path';
import type { AuthUser } from '../auth/service';
import { EnrichService } from '../llm/service';
import { WikiStorage } from '../storage/store';
import { createWikiServices } from '../wiki/service';
import type { AppDeps } from '../routes/deps';
import { CloudStorage } from './storage';
import { userLlmEnvironment } from '../llm/credentials';

/** 사용자마다 작업 큐·캐시·저장소를 분리한다. 데이터 API 요청은 항상 그 사용자의 토큰을 사용한다. */
export class CloudRuntime {
  private users = new Map<string, { deps: AppDeps; backend: CloudStorage; env: NodeJS.ProcessEnv }>();
  constructor(private readonly base: AppDeps) {}

  forUser(user: AuthUser): AppDeps {
    if (!user.cloud || !this.base.auth.cloud) return this.base;
    const { userId, accessToken } = user.cloud;
    const deployment = this.base.auth.cloud.config.deployment;
    const env = userLlmEnvironment({ userId, isAdmin: user.isAdmin }, deployment, this.base.store.get().llm.provider);
    const existing = this.users.get(userId);
    if (existing) {
      existing.backend.client.accessToken = accessToken;
      const changed = existing.env.OPENROUTER_API_KEY !== env.OPENROUTER_API_KEY || existing.env.VIBE_TEACHER_LLM_PROVIDER !== env.VIBE_TEACHER_LLM_PROVIDER;
      for (const name of Object.keys(existing.env)) if (!(name in env)) delete existing.env[name];
      Object.assign(existing.env, env);
      if (changed) existing.deps.enrich.invalidate();
      return existing.deps;
    }
    const projectIds = (id: string) => this.base.index.getProjectIds(id);
    const backend = new CloudStorage(this.base.auth.cloud.client(accessToken), userId, path.join(this.base.paths.home, 'wiki'));
    const storage = new WikiStorage(this.base.paths.home, projectIds, backend);
    const enrich = new EnrichService({ store: this.base.store, paths: this.base.paths, storage, env, requireUserKey: deployment !== 'local' });
    const services = createWikiServices(this.base.paths.home, this.base.store, () => enrich.resolveProvider(), projectIds, storage);
    const deps = { ...this.base, ...services, enrich, storage };
    this.users.set(userId, { deps, backend, env });
    return deps;
  }
}
