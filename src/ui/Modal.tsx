import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './icons';
import { tr } from '../i18n';

export function Modal({ title, onClose, children, wide, full, label, actions }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; /** Nearly the whole window, for content that needs room. */ full?: boolean; label?: string; /** Buttons placed in the header, left of the close button. */ actions?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef<Element | null>(null);
  useEffect(() => {
    prev.current = document.activeElement;
    const el = ref.current!;
    const focusables = () => [...el.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'));
    (el.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0] ?? el).focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); (prev.current as HTMLElement | null)?.focus?.(); };
  }, [onClose]);
  return (
    <div className="overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`modal ${wide ? 'wide' : ''} ${full ? 'full' : ''}`} role="dialog" aria-modal="true" aria-label={label ?? title} tabIndex={-1}>
        <div className="modal-head"><h2>{title}</h2><div className="modal-actions">{actions}<button className="icon-btn" aria-label={tr("Close dialog")} onClick={onClose}><Icon name="close" size={16} /></button></div></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
