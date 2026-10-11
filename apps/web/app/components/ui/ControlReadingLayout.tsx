import {DisclosureIndicator} from './Interaction';
import {PageGrid} from './PageFrame';
import {AdaptiveRail} from './AdaptiveRail';
import {useId, useRef, useState, type ReactNode} from 'react';

/** One control tree: a right rail on desktop, an expandable panel before mobile results. */
export function ControlReadingLayout({children, header, rail, label, summary}: {children: ReactNode; header?: ReactNode; rail: ReactNode; label: string; summary?: ReactNode}) {
  const id = useId(), toggle = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return <PageGrid variant="controls" className="control-reading-layout">
    {header && <div className="reading-page-heading">{header}</div>}
    <AdaptiveRail className="reading-control-rail" label={label}>
      <button ref={toggle} type="button" className="reading-control-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
        <span><strong>{label}</strong>{summary && <small>{summary}</small>}</span><DisclosureIndicator open={open}/>
      </button>
      <div id={id} className="reading-control-panel" data-open={open} onKeyDown={e=>{if(open&&e.key==='Escape'&&!window.matchMedia('(min-width:1120px)').matches){e.preventDefault();e.stopPropagation();setOpen(false);toggle.current?.focus({preventScroll:true})}}}>{rail}</div>
    </AdaptiveRail>
    <div className="reading-primary-content">{children}</div>
  </PageGrid>;
}
