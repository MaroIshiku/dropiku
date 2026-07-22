import type { FastifyReply } from "fastify";

export const errorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error", "message"],
  properties: {
    error: { type: "string" },
    message: { type: "string" },
    requestId: { type: "string" },
  },
} as const;

export function sendError(reply: FastifyReply, status: number, error: string, message: string) {
  return reply.code(status).send({ error, message, requestId: reply.request.id });
}

export function parsePositiveInt(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}
