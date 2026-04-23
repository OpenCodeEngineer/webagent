import { readFile } from 'node:fs/promises';

import type { FastifyInstance } from 'fastify';

const FALLBACK_WIDGET_BUNDLE = `console.warn('[WebAgent] widget bundle unavailable. Build @webagent/widget to enable embed script.');`;

let cachedWidgetBundle: string | null = null;
let attemptedLoad = false;

async function loadWidgetBundle(): Promise<string> {
  if (cachedWidgetBundle) {
    return cachedWidgetBundle;
  }

  if (attemptedLoad) {
    return FALLBACK_WIDGET_BUNDLE;
  }

  attemptedLoad = true;

  const candidates = [
    new URL('../../../widget/dist/widget.js', import.meta.url),
    new URL('../../../../widget/dist/widget.js', import.meta.url)
  ];

  for (const candidate of candidates) {
    try {
      cachedWidgetBundle = await readFile(candidate, 'utf8');
      return cachedWidgetBundle;
    } catch {
      // Try next candidate path.
    }
  }

  return FALLBACK_WIDGET_BUNDLE;
}

export function registerWidgetRoutes(app: FastifyInstance): void {
  app.get('/widget.js', async (_request, reply) => {
    const bundle = await loadWidgetBundle();
    return reply
      .type('application/javascript; charset=utf-8')
      .header('cache-control', 'public, max-age=300')
      .send(bundle);
  });
}
