import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ko } from '../i18n/ko';

/** 브라우저의 모달 기능으로 키보드 초점을 가두고, 닫으면 원래 버튼으로 돌려준다. */
export function Modal({ open, title, onClose, className = '', children }: { open: boolean; title: string; onClose: () => void; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open || !ref.current) return;
    const dialog = ref.current;
    const previous = document.documentElement.style.overflow;
    dialog.showModal();
    document.documentElement.style.overflow = 'hidden';
    return () => { dialog.close(); document.documentElement.style.overflow = previous; };
  }, [open]);
  return createPortal(
    <dialog ref={ref} className={`modal ${className}`} aria-labelledby={titleId} onKeyDown={(event) => {
      if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); onClose(); }
    }} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
    }}>
      <div className="modal-head"><h2 id={titleId}>{title}</h2><button type="button" className="btn btn-small" onClick={onClose} aria-label={ko.settings.close}>×</button></div>
      {children}
    </dialog>, document.body,
  );
}
