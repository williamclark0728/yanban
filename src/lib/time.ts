const DAY = 86_400_000;
const startOfDay = (t: number) => new Date(new Date(t).toDateString()).getTime();

export const clock = (t: number) =>
  new Date(t).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

/** 今天 / 昨天 / 周三 / 10月4日 / 2025年10月4日 */
export function dayLabel(t: number, now = Date.now()) {
  const diff = Math.round((startOfDay(now) - startOfDay(t)) / DAY);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  const d = new Date(t);
  if (diff < 7) return `周${"日一二三四五六"[d.getDay()]}`;
  if (d.getFullYear() === new Date(now).getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** Time shown in the chat list: clock for today, day label otherwise. */
export const listTime = (t: number) => (dayLabel(t) === "今天" ? clock(t) : dayLabel(t));

export const sameDay = (a: number, b: number) => startOfDay(a) === startOfDay(b);
