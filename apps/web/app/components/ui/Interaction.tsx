import type {ComponentPropsWithoutRef} from 'react';
import {IconChevronDown, IconExternal} from '../icons';

/** Quiet navigation/actions are distinct from prose references and paper titles. */
export function linkClass(variant: 'quiet' | 'source' | 'inline' = 'quiet') {
  return `hkis-link hkis-link-${variant}`;
}
export function ExternalLinkMark() { return <IconExternal size={13} className="link-mark"/>; }
/** The owning native details/button provides the expanded state and keyboard semantics. */
export function DisclosureIndicator({open, label=true}: {open?:boolean; label?:boolean}) {
  return <span className="disclosure-indicator" aria-hidden="true" data-open={open}>
    {label && (open === undefined ? <><span className="disclosure-closed-label">展开</span><span className="disclosure-open-label">收起</span></> : <span>{open?'收起':'展开'}</span>)}
    <IconChevronDown size={14} className="disclosure-caret"/>
  </span>;
}
export function DisclosureSummary({children,className='',...props}:ComponentPropsWithoutRef<'summary'>) {
  return <summary {...props} className={`disclosure-summary ${className}`}><span className="disclosure-label">{children}</span><DisclosureIndicator label={false}/></summary>;
}
