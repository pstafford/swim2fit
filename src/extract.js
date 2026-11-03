// Finds the swim sets inside the positioned text of an exported session PDF.
//
// The exports embed a bold font whose letters mostly cannot be decoded, so titles and
// "LIST OF EXERCISES" lines come out garbled. The sets are in the regular font and are clean.
// Bold lines are therefore used only as separators between the boxes on the page.

const LOOKS_LIKE_SET = /^(\d+\s*x\b|\d+\s*x\s*\d+|\d{2,}\b)|^warm/i;
const DATE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})\b/;
const MONTHS = 'JanFebMarAprMayJunJulAugSepOctNovDec';

export function extractSession(pages) {
  const items = pages.flat().filter((it) => it.str.trim());
  if (!items.length) return { text: '', date: null };

  const chars = {};
  for (const it of items) chars[it.fontName] = (chars[it.fontName] || 0) + it.str.length;
  const bodyFont = Object.keys(chars).sort((a, b) => chars[b] - chars[a])[0];

  let date = null;
  const dateItem = items.find((it) => it.fontName === bodyFont && DATE.test(it.str));
  if (dateItem) {
    const [, month, day, year] = dateItem.str.match(DATE);
    date = `${year}-${String(MONTHS.indexOf(month) / 3 + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const margin = Math.min(...items.map((it) => it.transform[4]));
  const boxes = [[]];
  for (const page of pages) {
    let lastY = null;
    const ordered = page.filter((it) => it.str.trim())
      .sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
    for (const it of ordered) {
      if (it.fontName !== bodyFont) {
        boxes.push([]);
        lastY = null;
        continue;
      }
      const [, , , , x, y] = it.transform;
      if (x > margin + 5) continue;
      const box = boxes[boxes.length - 1];
      if (lastY !== null && lastY - y > 15) box.push('');
      box.push(it.str.trim());
      lastY = y;
    }
  }

  const swim = boxes.filter((box) => box.some((line) => LOOKS_LIKE_SET.test(line)));
  return { text: swim.map((box) => box.join('\n')).join('\n\n'), date };
}
