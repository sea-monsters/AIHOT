import { beijingWeekday } from "../../lib/format";

/** Only long narrative paragraphs qualify; identifiers and enumerations keep natural spacing. */
export function isProseParagraph(text: string): boolean {
  const plain=text.replace(/\*\*/g,'');
  return plain.length>=80 && (plain.match(/[\u3400-\u9fff]/g)?.length??0)/plain.length>=.7
    && !/[A-Za-z0-9]|https?:|[\n\t]|[;\uff1b]/.test(plain)
    && !/^\s*(?:[-*\u2022]|[一二三四五六七八九十]+[\u3001\uff09)])/.test(plain);
}

/** Release notes carry a little Markdown: **bold** runs. */
export function Inline({ text }: { text: string }) {
  return <>{text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i} className="font-semibold text-ink-2">{part}</b> : part))}</>;
}

export function dateHeading(date: string): { label: string; weekday: string } {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return { label: `${y} 年 ${m} 月 ${d} 日`, weekday: beijingWeekday(date).replace("星期", "周") };
}
