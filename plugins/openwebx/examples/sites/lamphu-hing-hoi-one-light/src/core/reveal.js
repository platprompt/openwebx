// Text entrance choreography.
// - The page is readable before this runs: nothing is hidden until the
//   runtime is live. setupReveal() first marks every chapter already on
//   screen as .is-in, then adds html.ox-live, so what the reader is looking
//   at never blinks out. Chapters further down get .is-in as they enter; CSS
//   staggers their direct children using --ri (capped so long articles do
//   not animate paragraph by paragraph).
// - Elements with [data-split] are split into word spans with Intl.Segmenter,
//   which segments Thai/Japanese/Chinese correctly (no spaces between words).
//   The original text stays in the DOM, so crawlers and find-in-page still work.
//   Punctuation joins the word before it. Thai, Lao, Khmer and Myanmar are not
//   split: a word span is a line-break opportunity, and their segmenters cut
//   compounds (ดวง|จันทร์) where the browser's own line breaker would not, so
//   those headings keep native breaking and use the block-level reveal.

const STAGGER_CAP = 8;

const NO_SPLIT = /^(th|lo|km|my)(?![a-z])/i;

export function splitWords(el, lang) {
  if (el.dataset.splitDone) return;
  const own = el.closest('[lang]')?.getAttribute('lang') || lang || '';
  if (NO_SPLIT.test(own)) {
    el.removeAttribute('data-split'); // block-level reveal, native line breaks
    return;
  }
  // Only split plain-text headings; inline markup would be flattened.
  if ([...el.childNodes].some((n) => n.nodeType === 1 && !['EM', 'I', 'STRONG', 'B', 'BR'].includes(n.nodeName))) {
    el.removeAttribute('data-split'); // falls back to the block-level reveal
    return;
  }
  const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(lang || undefined, { granularity: 'word' }) : null;
  let i = 0;
  const wrapText = (text, parent) => {
    const parts = seg ? [...seg.segment(text)] : text.split(/(\s+)/).map((segment) => ({ segment, isWordLike: true }));
    let last = null; // the previous word's inner span, for trailing punctuation
    for (const { segment: part, isWordLike } of parts) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        parent.appendChild(document.createTextNode(part));
        last = null;
        continue;
      }
      if (!isWordLike && last) {
        last.textContent += part; // "โต๊ะ:" stays one unit, never ": เข้าใจ"
        continue;
      }
      const outer = document.createElement('span');
      outer.className = 'ox-w';
      const inner = document.createElement('span');
      inner.textContent = part;
      inner.style.setProperty('--wi', String(i++));
      outer.appendChild(inner);
      parent.appendChild(outer);
      last = inner;
    }
  };
  const nodes = [...el.childNodes];
  el.textContent = '';
  for (const n of nodes) {
    if (n.nodeType === 3) wrapText(n.textContent, el);
    else if (n.nodeName === 'BR') el.appendChild(n);
    else {
      const clone = n.cloneNode(false);
      wrapText(n.textContent, clone);
      el.appendChild(clone);
    }
  }
  el.dataset.splitDone = '1';
}

export function setupReveal(sections, lang) {
  document.querySelectorAll('[data-split]').forEach((el) => splitWords(el, lang));
  for (const s of sections) {
    const inner = s.querySelector('.ox-chapter__inner') || s;
    [...inner.children].forEach((c, k) => c.style.setProperty('--ri', String(Math.min(k, STAGGER_CAP))));
  }
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              e.target.classList.add('is-in');
              io.unobserve(e.target);
            }
          }
        },
        { rootMargin: '0px 0px -15% 0px', threshold: 0.01 }
      )
    : null;
  const h = innerHeight;
  for (const s of sections) {
    const r = s.getBoundingClientRect();
    if (!io || (r.top < h && r.bottom > 0)) s.classList.add('is-in');
    else io.observe(s);
  }
  document.documentElement.classList.add('ox-live');
}
