import type { FastifyInstance } from 'fastify';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

let widgetJs: string | null = null;

function loadWidgetJs(): string {
  if (widgetJs) return widgetJs;
  
  // Try built widget first, then fallback
  const paths = [
    resolve(import.meta.dirname, '../../../widget/dist/widget.js'),
    resolve(import.meta.dirname, '../../node_modules/@webagent/widget/dist/widget.js'),
  ];
  
  for (const p of paths) {
    if (existsSync(p)) {
      widgetJs = readFileSync(p, 'utf8');
      return widgetJs;
    }
  }
  
  return '// WebAgent widget not built yet. Run: pnpm --filter @webagent/widget build';
}

export function registerWidgetRoutes(app: FastifyInstance) {
  app.get('/widget.js', async (_req, reply) => {
    const js = loadWidgetJs();
    reply.type('application/javascript').send(js);
  });
}
