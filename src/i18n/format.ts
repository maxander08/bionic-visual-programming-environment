// Locale-aware rendering of the strings the Timekeeping modules produce. The engine always emits one neutral English
// form (“Sat 14 Nov 2026”, “1:32:38 PM”, “in 2d 14:57:21.708”) so saved programs and tests never depend on the interface
// language; the node faces turn that form into the reader's language here, at display time, so a language switch
// updates every clock, alarm and stopwatch that is already on the workspace.
import { getLang, tr, trFace } from './index';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD_HANS = ['日', '一', '二', '三', '四', '五', '六'];

/** “1:32:38.292 PM” → “下午 1:32:38.292”. 24-hour times and English are unchanged. */
export function fmtClockTime(s: string): string {
  if (getLang() === 'en') return s;
  const m = /^(.*?)\s?(AM|PM)$/.exec(s);
  return m ? `${trFace(m[2])} ${m[1]}` : s;
}

/** “Sat 14 Nov 2026” → “2026年11月14日 周六” (Simplified) / “2026年11月14日 週六” (Traditional). */
export function fmtClockDate(s: string): string {
  const lang = getLang();
  if (lang === 'en') return s;
  const m = /^([A-Za-z]{3}) (\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(s);
  if (!m) return s;
  const wd = WEEKDAYS.indexOf(m[1]), mo = MONTHS.indexOf(m[3]);
  if (wd < 0 || mo < 0) return s;
  return `${m[4]}年${mo + 1}月${Number(m[2])}日 ${lang === 'zh-Hant' ? '週' : '周'}${WD_HANS[wd]}`;
}

/** “2d 14:57:21.708” → “2天 14:57:21.708”. */
export function fmtSpan(s: string): string {
  return getLang() === 'en' ? s : s.replace(/(\d+)d\b/g, '$1天');
}

/** “in 14:57:21.708” → “14:57:21.708后”. */
export function fmtCountdown(s: string): string {
  return getLang() === 'en' ? `in ${s}` : tr('in {t}', { t: fmtSpan(s) });
}
