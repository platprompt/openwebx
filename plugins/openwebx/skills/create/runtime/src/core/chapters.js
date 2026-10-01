// Which chapter is being read, and travel between chapters.
//
// Navigation is plain markup from the scaffold, so it works without
// JavaScript: the contents in chapter 0 (<nav id="contents">, links to
// #ch-N) and each chapter's folio (a link back to #contents). This module
// adds travel that respects reduced motion and carries keyboard focus with
// the reader, and it marks the current chapter:
//   aria-current="true" on its contents link, .is-current on its section,
//   html[data-chapter="N"], and the bus event `chapter` {index, prev, id, name}.

export class Chapters {
  constructor(sections, bus, motion) {
    this.sections = sections;
    this.bus = bus;
    this.motion = motion;
    this.index = -1;
    const links = [...document.querySelectorAll('#contents a[href^="#ch-"]')];
    // One entry per section (null when the contents does not list it).
    this.links = sections.map((s) => links.find((a) => a.getAttribute('href') === `#${s.id}`) || null);
    this._link = null;
    document.addEventListener('click', (e) => this._click(e));
  }

  _click(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.('a[href^="#ch-"], a[href="#contents"], [data-go]');
    if (!a) return;
    const id = a.getAttribute('data-go') ?? a.getAttribute('href').slice(1);
    const el = /^\d+$/.test(id) ? this.sections[+id] : document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    this.goTo(el);
  }

  goTo(el) {
    el.scrollIntoView({ behavior: this.motion.reduced ? 'auto' : 'smooth', block: 'start' });
    // Move focus with the reader, as a native in-page link would.
    if (el.getAttribute('aria-hidden') !== 'true') {
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
    }
    history.replaceState(null, '', `#${el.id}`);
    this.bus.emit('navigate', { id: el.id });
  }

  // Driven by Scroll's discrete chapter so the page and the scene agree.
  set(i) {
    if (i === this.index || i < 0) return;
    const prev = this.index;
    this.index = i;
    const el = this.sections[i];
    if (this._link) this._link.removeAttribute('aria-current');
    this._link = this.links[i];
    if (this._link) this._link.setAttribute('aria-current', 'true');
    if (prev >= 0) this.sections[prev]?.classList.remove('is-current');
    el?.classList.add('is-current');
    document.documentElement.dataset.chapter = String(i);
    this.bus.emit('chapter', { index: i, prev, id: el?.id, name: el?.dataset.name });
  }
}
