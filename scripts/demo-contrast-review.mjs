// Diagnostic follow-up for incomplete axe results in disposable demo consumers.
// Keep the original results intact; a scrolled view is separate evidence.
const rgb = text => {
  const match = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/.exec(text);
  return match ? { channels: match.slice(1, 4).map(Number), alpha: Number(match[4] ?? 1) } : null;
};
const luminance = channels => channels.map(value => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
function colors(target, modal) {
  const foreground = getComputedStyle(target).color;
  const parsed = rgb(foreground);
  const ancestors = [];
  let background;
  for (let current = target; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    ancestors.push({ tag: current.tagName, background: style.backgroundColor });
    if (style.backgroundImage !== 'none' || style.opacity !== '1' || style.filter !== 'none'
      || style.mixBlendMode !== 'normal') return { foreground, ancestors, ratio: null };
    const candidate = rgb(style.backgroundColor);
    if (!candidate || (candidate.alpha !== 0 && candidate.alpha !== 1)) return { foreground, ancestors, ratio: null };
    if (candidate.alpha === 1) { background = candidate; break; }
    if (current === modal) break;
  }
  if (!parsed || parsed.alpha !== 1 || !background) return { foreground, ancestors, ratio: null };
  const values = [luminance(parsed.channels), luminance(background.channels)].sort((a, b) => b - a);
  return { foreground, ancestors, ratio: (values[0] + 0.05) / (values[1] + 0.05), minimumCompared: 4.5 };
}
function inspect(selector, modal) {
  let target;
  try { target = document.querySelector(selector); } catch { return { selector, unavailable: true }; }
  if (!target || !modal.contains(target)) return { selector, unavailable: true };
  const crop = modal.getBoundingClientRect();
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
  const lines = [];
  while (walker.nextNode()) {
    const text = walker.currentNode;
    if (!text.textContent.trim()) continue;
    const range = document.createRange(); range.selectNodeContents(text);
    for (const bounds of range.getClientRects()) {
      const samples = [];
      for (const horizontal of [0.1, 0.5, 0.9]) for (const vertical of [0.2, 0.5, 0.8]) {
        const x = bounds.left + bounds.width * horizontal, y = bounds.top + bounds.height * vertical;
        const inside = x >= Math.max(0, crop.left) && x <= Math.min(innerWidth, crop.right)
          && y >= Math.max(0, crop.top) && y <= Math.min(innerHeight, crop.bottom);
        const hit = inside ? document.elementFromPoint(x, y) : null;
        samples.push({ insideVisibleDialog: inside, hitTextOwner: hit === text.parentElement,
          hit: hit ? { tag: hit.tagName, id: hit.id } : null });
      }
      lines.push({ bounds: bounds.toJSON(), samples });
    }
  }
  return { selector, scrollTop: modal.scrollTop, clientHeight: modal.clientHeight, scrollHeight: modal.scrollHeight,
    targetBounds: target.getBoundingClientRect().toJSON(), colors: colors(target, modal), lines };
}
export async function reviewContrast(result, summarize) {
  const selectors = [...new Set(result.incomplete.filter(rule => rule.id === 'color-contrast')
    .flatMap(rule => rule.nodes.map(item => item.target.join(' '))))];
  const modal = document.querySelector('#confirmation');
  if (!modal?.open || selectors.length === 0) return null;
  const original = modal.scrollTop;
  const before = selectors.map(selector => inspect(selector, modal));
  try {
    modal.scrollTop = 0;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const top = selectors.map(selector => inspect(selector, modal));
    const rescanned = await axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } });
    return { before, top, topScan: { violations: rescanned.violations.map(summarize),
      incomplete: rescanned.incomplete.map(summarize) },
    limits: 'Computed solid-color contrast and sampled DOM hit testing; not a pixel or assistive-technology assessment.' };
  } finally { modal.scrollTop = original; }
}
