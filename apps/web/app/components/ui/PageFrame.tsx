import type {ReactNode} from 'react';

/** Every public route inherits the same canvas and alignment grid, including error states. */
export function PageFrame({children}:{children:ReactNode}) {
  return <div className="page-frame">{children}</div>;
}

/** Headers keep their semantic content; spacing and type scale have one owner. */
export function PageHeader({children,className=''}:{children:ReactNode;className?:string}) {
  return <header className={`page-header research-heading ${className}`}>{children}</header>;
}

/** A shared main/rail track. Variants change placement, never track widths or gutters. */
export function PageGrid({children,variant='single',className=''}:{children:ReactNode;variant?:'single'|'assistant'|'controls'|'article';className?:string}) {
  return <div className={`page-grid page-grid-${variant} ${className}`} data-page-grid={variant}>{children}</div>;
}
