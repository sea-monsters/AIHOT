import type {ComponentPropsWithRef, HTMLAttributes} from 'react';

/** Native controls preserve each existing appearance; domain actions stay at the call site. */
const actions = {primary:'research-primary',secondary:'ai-secondary',text:'paper-text-button'} as const;
export function actionClass(appearance:keyof typeof actions){return actions[appearance]}
export function ActionButton({appearance,className, ...props}:ComponentPropsWithRef<'button'>&{appearance:keyof typeof actions}) {
  return <button className={actionClass(appearance)+(className?' '+className:'')} {...props}/>;
}
const notices={notice:'research-notice',error:'ai-error',success:'ai-notice'} as const;
/** Role remains explicit: a static warning is not automatically a live alert. */
export function Notice({tone,as:Tag='p',className,...props}:HTMLAttributes<HTMLElement>&{tone:keyof typeof notices;as?:'p'|'div'|'section'}) {
  return <Tag className={notices[tone]+(className?' '+className:'')} {...props}/>;
}
export function Stats(props:ComponentPropsWithRef<'div'>){return <div className="research-stats" {...props}/>}
export function Pagination(props:ComponentPropsWithRef<'nav'>){return <nav className="research-pagination" {...props}/>}
export function SectionHeading(props:ComponentPropsWithRef<'div'>){return <div className="weekly-section-title" {...props}/>}
export function FilterActions(props:ComponentPropsWithRef<'div'>){return <div className="rail-filter-actions" {...props}/>}
export function EmptyState({as:Tag='div',...props}:HTMLAttributes<HTMLElement>&{as?:'div'|'section'|'p'}){return <Tag className="research-empty" {...props}/>}
