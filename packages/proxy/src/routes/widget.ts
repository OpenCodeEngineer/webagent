import type { FastifyInstance } from 'fastify';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

interface WidgetCache {
  path: string;
  mtimeMs: number;
  content: string;
}

let widgetCache: WidgetCache | null = null;

function resolveWidgetDistPath(): string | null {
  const paths = [
    resolve(process.cwd(), 'packages/proxy/dist/widget.js'),
    resolve(import.meta.dirname, '../../dist/widget.js'),
    resolve(import.meta.dirname, '../widget.js'),
  ];

  for (const path of paths) {
    if (existsSync(path)) return path;
  }
  return null;
}

function loadWidgetJs(): string | null {
  const widgetPath = resolveWidgetDistPath();
  if (!widgetPath) return null;

  const stat = statSync(widgetPath);
  if (widgetCache && widgetCache.path === widgetPath && widgetCache.mtimeMs === stat.mtimeMs) {
    return widgetCache.content;
  }

  const content = readFileSync(widgetPath, 'utf8');
  widgetCache = { path: widgetPath, mtimeMs: stat.mtimeMs, content };
  return content;
}

export function registerWidgetRoutes(app: FastifyInstance) {
  app.options('/widget.js', async (_req, reply) => {
    reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Methods', 'GET, OPTIONS')
      .header('Access-Control-Allow-Headers', 'Content-Type')
      .code(204)
      .send();
  });

  app.get('/widget.js', async (_req, reply) => {
    const js = loadWidgetJs();
    if (!js) {
      reply.code(404).type('application/javascript').send('// Widget asset not found');
      return;
    }

    reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Methods', 'GET, OPTIONS')
      .header('Access-Control-Allow-Headers', 'Content-Type')
      .header('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400')
      .type('application/javascript')
      .send(js);
  });
}
