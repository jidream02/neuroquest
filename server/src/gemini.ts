import { DmResponseSchema, type DmResponse } from '../../shared/dmProtocol.ts';

const URL = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export class DmUnavailableError extends Error {}

/** Достаём JSON-объект, даже если модель обернула его в ```json или добавила текст. */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('В ответе модели нет JSON');
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

async function callModel(apiKey: string, model: string, system: string, user: string): Promise<DmResponse> {
  const res = await fetch(URL(model), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.9, maxOutputTokens: 2048 },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    // Тело ошибки логируем на сервере, но клиенту его не отдаём — там могут быть детали аккаунта.
    const body = await res.text();
    throw new Error(`Gemini ${model} HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data: any = await res.json();
  const parts: any[] | undefined = data?.candidates?.[0]?.content?.parts;
  if (!parts) throw new Error(`Gemini ${model}: пустой ответ (${data?.promptFeedback?.blockReason ?? 'нет кандидатов'})`);
  const text = parts.filter((p) => !p.thought).map((p) => p.text ?? '').join('');
  // Ответ ИИ проверяется той же схемой, что и на клиенте.
  return DmResponseSchema.parse(extractJson(text));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Перегрузка (503), лимит (429) и таймаут — временные ошибки: стоит подождать и повторить.
const isTransient = (e: unknown) => /HTTP (429|500|503)|timeout|aborted|fetch failed/i.test(String((e as Error)?.message ?? e));

/** Основная модель, при ошибке — запасная. Временные ошибки повторяются с паузой. */
export async function askGemini(
  apiKey: string,
  models: string[],
  system: string,
  user: string,
): Promise<{ dm: DmResponse; model: string }> {
  let lastErr: unknown;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return { dm: await callModel(apiKey, model, system, user), model };
      } catch (e) {
        lastErr = e;
        console.warn(`[dm] ${model} попытка ${attempt + 1}: ${(e as Error).message.split('\n')[0]}`);
        if (!isTransient(e)) break; // кривой ответ модели — сразу к запасной модели
        await sleep(1000 * (attempt + 1));
      }
    }
  }
  throw new DmUnavailableError(String((lastErr as Error)?.message ?? lastErr));
}
