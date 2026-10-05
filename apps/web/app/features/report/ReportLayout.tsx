import {PageHeader,PageGrid} from '../../components/ui/PageFrame';
import type { ReactNode } from "react";
import type { ReportNavigationEntry, ReportKind } from "@aihot/contracts/site";
import { ReportArchive, ReportPhoneNav } from "./ReportNav";

/**
 * Report pages sit beside their own archive column (desktop), flush against the site sidebar; phones
 * get the kind tabs and recent issues above the page instead. The paper is centred beside the archive,
 * on white in the light theme, up to 1160px.
 */
export function ReportLayout({ kind, index, current, today, children }: { kind: ReportKind; index: ReportNavigationEntry[]; current: string | null; today: string; children: ReactNode }) {
  return <div className="research-page report-shell">
    {!current&&<PageHeader><div><p className="research-eyebrow">HKIS / LEGACY REPORTS</p><h1>{kind==='weekly'?'原版周报':kind==='monthly'?'原版月报':'原版日报'}</h1></div></PageHeader>}
    <PageGrid variant="article">
      <div className="reading-primary-content"><ReportPhoneNav kind={kind} index={index} current={current} today={today} />{children}</div>
      <div className="reading-secondary-rail"><ReportArchive kind={kind} index={index} current={current} /></div>
    </PageGrid>
  </div>;
}
