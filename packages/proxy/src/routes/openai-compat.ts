import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { PassThrough } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { OpenClawClient } from '../openclaw/client.js';
import { buildAgentSessionKey } from '../openclaw/sessions.js';
import { detectAgentCreation } from './api.js';

const messageSchema = z.object({
  role: z.string().min(1),
  content: z.string(),
});

const chatCompletionBodySchema = z.object({
  model: z.string().min(1),
  messages: z.array(messageSchema).min(1),
  stream: z.boolean().optional(),
  user: z.string().min(1).optional(),
});

type ChatCompletionBody = z.infer<typeof chatCompletionBodySchema>;

function parseBearerToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string') {
    return null;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function isAuthorized(request: FastifyRequest): boolean {
  const expectedToken = process.env.PROXY_API_TOKEN?.trim() || process.env.PROXY_CUSTOMER_API_TOKEN?.trim() || '';
  const providedToken = parseBearerToken(request) || '';
  if (!expectedToken || !providedToken) {
    return false;
  }

  const expectedBuffer = Buffer.from(expectedToken);
  const providedBuffer = Buffer.from(providedToken);
  if (expectedBuffer.length !== providedBuffer.length) {
    timingSafeEqual(expectedBuffer, expectedBuffer);
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function sendOpenAiError(reply: FastifyReply, statusCode: number, message: string) {
  return reply.status(statusCode).send({
    error: {
      message,
      type: 'invalid_request_error',
    },
  });
}

function resolveLastUserMessage(body: ChatCompletionBody): string {
  return body.messages
    .filter((message) => message.role.toLowerCase() === 'user')
    .map((message) => message.content.trim())
    .filter((message) => message.length > 0)
    .at(-1) ?? '';
}

function resolveCustomerId(request: FastifyRequest, body: ChatCompletionBody): string {
  const explicitUser = body.user?.trim();
  if (explicitUser) {
    return explicitUser;
  }

  const userAgentHeader = request.headers['user-agent'];
  const userAgent = Array.isArray(userAgentHeader)
    ? userAgentHeader[0] ?? ''
    : (typeof userAgentHeader === 'string' ? userAgentHeader : '');
  const identitySource = `${request.ip}|${userAgent}`;
  const hash = createHash('sha256').update(identitySource).digest('hex');
  return `ctx-${hash.slice(0, 32)}`;
}

function toOpenAiModel(model: string): string {
  return model.trim() || 'meta-agent';
}

function toAgentId(model: string): string {
  return model === 'meta-agent' ? 'meta' : model;
}

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export function registerOpenAiCompatRoutes(app: FastifyInstance) {
  app.post('/v1/chat/completions', async (request, reply) => {
    if (!isAuthorized(request)) {
      return sendOpenAiError(reply, 401, 'Invalid or missing bearer token');
    }

    const parsed = chatCompletionBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendOpenAiError(reply, 400, 'Invalid request body');
    }

    const body = parsed.data;
    const model = toOpenAiModel(body.model);
    const agentId = toAgentId(model);
    const customerId = resolveCustomerId(request, body);
    const lastUserMessage = resolveLastUserMessage(body);
    if (!lastUserMessage) {
      return sendOpenAiError(reply, 400, 'No user message provided');
    }

    const sessionKey = buildAgentSessionKey(agentId, customerId);
    const completionId = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    const domain = (process.env.AUTH_URL || 'https://dev.lamoom.com').replace(/\/+$/, '');

    const openclaw = new OpenClawClient();
    const stream = body.stream === true;

    if (!stream) {
      // Non-streaming: simple request-response
      try {
        const response = await openclaw.sendMessage({
          message: lastUserMessage,
          agentId,
          sessionKey,
          name: 'openai-compat',
          timeoutSeconds: 240,
        });

        if (!response.success) {
          return sendOpenAiError(reply, 502, response.error || 'Upstream agent error');
        }

        const finalResponse = response.response ?? '';
        await detectAgentCreation(finalResponse, customerId, app, domain);

        return reply.send({
          id: completionId,
          object: 'chat.completion',
          created,
          model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: finalResponse },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      } catch (error) {
        request.log.error({ error }, 'openai-compat non-stream error');
        return sendOpenAiError(reply, 503, 'OpenClaw service unavailable');
      }
    }

    // Streaming: use a PassThrough stream piped through Fastify's reply.send()
    const sse = new PassThrough();

    reply
      .header('Content-Type', 'text/event-stream')
      .header('Cache-Control', 'no-cache')
      .header('Connection', 'keep-alive')
      .header('X-Accel-Buffering', 'no')
      .send(sse);

    // Initial role chunk
    sse.write(sseChunk({
      id: completionId,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
    }));

    try {
      const response = await openclaw.sendMessage({
        message: lastUserMessage,
        agentId,
        sessionKey,
        name: 'openai-compat',
        timeoutSeconds: 240,
      });

      if (!response.success) {
        sse.write(sseChunk({
          error: {
            message: response.error || 'Upstream agent error',
            type: 'server_error',
          },
        }));
        sse.write('data: [DONE]\n\n');
        sse.end();
        return;
      }

      const finalResponse = response.success ? (response.response ?? '') : '';
      await detectAgentCreation(finalResponse, customerId, app, domain);

      if (finalResponse) {
        sse.write(sseChunk({
          id: completionId,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta: { content: finalResponse }, finish_reason: null }],
        }));
      }
    } catch (error) {
      request.log.error({ error }, 'openai-compat stream error');
    }

    // Finish
    sse.write(sseChunk({
      id: completionId,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    }));
    sse.write('data: [DONE]\n\n');
    sse.end();
  });

  app.get('/v1/models', async () => {
    return {
      object: 'list',
      data: [
        {
          id: 'meta-agent',
          object: 'model',
          owned_by: 'webagent',
        },
      ],
    };
  });
}
