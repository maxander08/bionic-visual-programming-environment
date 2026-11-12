import { useEffect } from 'react';

/**
 * Replaces native `title` bubbles with an in-page tooltip.
 *
 * Native tooltips are painted by the operating system in a system font, which would put Chinese text outside the
 * two permitted typefaces (Noto Sans SC / Noto Sans TC). This tooltip is ordinary DOM, so it inherits the app's
 * font stack. While the pointer or keyboard focus is on an element, its `title` is moved to `data-tip` (so the OS
 * bubble never appears) and restored afterwards, so assistive technology still sees it the rest of the time.
 */
export function TitleTips() {
  useEffect(() => {
    const tip = document.createElement('div');
    tip.className = 'ns-tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);

    let host: HTMLElement | null = null;
    let timer = 0;

    const restore = () => {
      window.clearTimeout(timer);
      tip.classList.remove('on');
      if (host) {
        const t = host.getAttribute('data-tip');
        if (t !== null && !host.hasAttribute('title')) host.setAttribute('title', t);
        host.removeAttribute('data-tip');
        host = null;
      }
    };

    const place = (el: HTMLElement, pointer?: { x: number; y: number }) => {
      const r = el.getBoundingClientRect();
      const w = tip.offsetWidth, h = tip.offsetHeight;
      const cx = pointer ? pointer.x : r.left + r.width / 2;
      let x = Math.min(Math.max(8, cx - w / 2), window.innerWidth - w - 8);
      let y = r.bottom + 8;
      if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 8);
      tip.style.transform = '';
      tip.style.left = `${Math.round(x)}px`;
      tip.style.top = `${Math.round(y)}px`;
    };

    const show = (el: HTMLElement, pointer?: { x: number; y: number }, delay = 380) => {
      if (host === el) return;
      restore();
      const text = el.getAttribute('title');
      if (!text || !text.trim()) return;
      host = el;
      el.setAttribute('data-tip', text);
      el.removeAttribute('title');
      tip.textContent = text;
      timer = window.setTimeout(() => {
        if (host !== el) return;
        place(el, pointer);
        tip.classList.add('on');
      }, delay);
    };

    const find = (t: EventTarget | null) => (t instanceof Element ? (t.closest('[title],[data-tip]') as HTMLElement | null) : null);

    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = find(e.target);
      if (el && el.hasAttribute('title')) show(el, { x: e.clientX, y: e.clientY });
      else if (!el) restore();
    };
    const out = (e: PointerEvent) => {
      if (!host) return;
      const to = e.relatedTarget;
      if (to instanceof Node && host.contains(to)) return;
      restore();
    };
    const focusIn = (e: FocusEvent) => {
      const el = find(e.target);
      if (el && el.hasAttribute('title') && (e.target as HTMLElement).matches?.(':focus-visible')) show(el, undefined, 0);
    };
    const hide = () => restore();

    document.addEventListener('pointerover', over, true);
    document.addEventListener('pointerout', out, true);
    document.addEventListener('focusin', focusIn, true);
    document.addEventListener('focusout', hide, true);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      restore();
      document.removeEventListener('pointerover', over, true);
      document.removeEventListener('pointerout', out, true);
      document.removeEventListener('focusin', focusIn, true);
      document.removeEventListener('focusout', hide, true);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
      tip.remove();
    };
  }, []);
  return null;
}
