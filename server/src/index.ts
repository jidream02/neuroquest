/**
 * NeuroQuest API — маленький прокси между приложением и ИИ (Gemini).
 * Зачем он нужен: ключ ИИ нельзя хранить в мобильном приложении — любой может
 * распаковать APK/бандл и достать его. Ключ живёт только здесь, в .env.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { TurnRequestSchema } from '../../shared/dmProtocol.ts';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.ts';
import { askGemini, DmUnavailableError } from './gemini.ts';
import { offlineDm } from '../../shared/offlineDm.ts';

const PORT = Number(process.env.PORT ?? 8787);
const API_KEY = process.env.GEMINI_API_KEY?.trim() ?? '';
const MODELS = [process.env.GEMINI_MODEL, process.env.GEMINI_FALLBACK_MODEL].filter(
  (m): m is string => Boolean(m && m.trim()),
);
// mock — всегда офлайн-мастер; ai — только ИИ; auto — ИИ, а при сбое офлайн-мастер.
const MODE = (process.env.DM_MODE ?? (API_KEY ? 'auto' : 'mock')) as 'ai' | 'mock' | 'auto';
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:8081')
  .split(',')
  .map((s) => s.trim());

const app = express();
app.disable('x-powered-by'); // не раскрываем технологию сервера

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// CORS нужен только браузеру (Expo Web). Мобильные приложения Origin не присылают.
app.use(
  cors({
    origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.includes(origin)),
    methods: ['GET', 'POST'],
  }),
);

app.use(express.json({ limit: '64kb' })); // защита от огромных запросов

// Не больше 20 ходов в минуту с одного адреса — защищает лимиты ИИ от злоупотреблений.
const turnLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Слишком много запросов, подождите минуту.' },
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mode: MODE, ai: MODE !== 'mock' && API_KEY.length > 0 });
});

app.post('/api/dm/turn', turnLimiter, async (req, res) => {
  const parsed = TurnRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'invalid_request',
      message: 'Некорректные данные запроса',
      issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  const turn = parsed.data;

  if (MODE === 'mock' || !API_KEY || MODELS.length === 0) {
    res.json({ dm: offlineDm(turn), model: 'offline' });
    return;
  }

  try {
    const result = await askGemini(API_KEY, MODELS, SYSTEM_PROMPT, buildUserPrompt(turn));
    res.json(result);
  } catch (e) {
    if (e instanceof DmUnavailableError && MODE === 'auto') {
      res.json({ dm: offlineDm(turn), model: 'offline' });
      return;
    }
    res.status(503).json({ error: 'dm_unavailable', message: 'ИИ-мастер временно недоступен, попробуйте ещё раз.' });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// Единый обработчик ошибок: клиент никогда не видит стек-трейс.
app.use((err: Error & { type?: string; status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  if (err.type === 'entity.too.large') {
    res.status(413).json({ error: 'too_large', message: 'Запрос слишком большой' });
    return;
  }
  if (err.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'bad_json', message: 'Некорректный JSON' });
    return;
  }
  console.error('[server]', err);
  res.status(500).json({ error: 'internal', message: 'Внутренняя ошибка сервера' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`NeuroQuest API на :${PORT} | режим ${MODE} | модели: ${MODELS.join(' → ') || '—'}`);
});
