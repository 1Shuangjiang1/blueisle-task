import { X } from "lucide-react";
import type { ReactNode } from "react";

interface ModalProps { title: string; children: ReactNode; onClose: () => void; }

export function Modal({ title, children, onClose }: ModalProps) {
  return <div className="ui-modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="ui-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
      <header><h2>{title}</h2><button className="ui-icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button></header>
      {children}
    </section>
  </div>;
}
