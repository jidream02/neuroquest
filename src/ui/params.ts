/** Параметр маршрута → целое положительное число или null (защита от «/hero/abc» и «/hero/-1»). */
export function parseId(raw: string | string[] | undefined): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (!s || !/^\d{1,9}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}
