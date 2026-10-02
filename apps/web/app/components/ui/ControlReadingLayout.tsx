import {useId, useState, type ReactNode} from 'react';

/** One control tree: a right rail on desktop, an expandable panel before mobile results. */
export function ControlReadingLayout({children, rail, label, summary}: {children: ReactNode; rail: ReactNode; label: string; summary?: ReactNode}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return <div className="control-reading-layout">
    <aside className="reading-control-rail" aria-label={label}>
      <button type="button" className="reading-control-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
        <span><strong>{label}</strong>{summary && <small>{summary}</small>}</span><span aria-hidden="true">{open ? '收起 −' : '展开 +'}</span>
      </button>
      <div id={id} className="reading-control-panel" data-open={open}>{rail}</div>
    </aside>
    <div className="reading-primary-content">{children}</div>
  </div>;
}
