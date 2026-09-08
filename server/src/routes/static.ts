import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';

/** web/dist 가 있으면 정적 서빙 + SPA fallback */
export function staticRoutes(distDir: string): Hono | null {
  const indexHtml = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexHtml)) return null;
  const app = new Hono();
  const relRoot = path.relative(process.cwd(), distDir) || '.';
  app.use('/*', serveStatic({ root: relRoot }));
  app.get('/*', async (c) => {
    if (c.req.path.startsWith('/api/')) return c.notFound();
    const html = await fs.promises.readFile(indexHtml, 'utf8');
    return c.html(html);
  });
  return app;
}
