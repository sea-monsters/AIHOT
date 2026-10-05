import {SectionLink} from '../ReadingContinuity';
import {QuickSearch} from "../WebSearch";
import {AssistantEntry} from "../AssistantEntry";
import { SITE } from "@aihot/industry/site";
import { Link, useLocation } from "react-router";
import { Wordmark } from "../Logo";
import {UpdateDot,useNavigationUpdates} from "../NavigationUpdates";
import {updatePageForPath,updatePageDestination} from "@aihot/contracts/navigation-updates";
import { SIDEBAR, tabIsActive, type NavItem } from "./nav";
import { ThemeSwitch } from "./ThemeSwitch";

function SideLink({ item }: { item: NavItem }) {
  const { pathname } = useLocation();const {pages}=useNavigationUpdates();
  // Weekly and monthly reports belong to the daily report entry, as the phone tab bar has it.
  const isActive = tabIsActive(item, pathname);
  const Icon = item.icon;
  return (
    <SectionLink
      to={updatePageDestination(item.to,pages)}
      prefetch="intent"
      aria-current={isActive ? "page" : undefined}
      className={`flex h-9 items-center gap-2 rounded-control px-2.5 text-[14px] transition-colors duration-150 ${
        isActive ? "bg-selected font-semibold text-accent-ink" : "font-medium text-ink-3 hover:bg-bg-sunk hover:text-ink"
      }`}
    >
      <span className={`flex w-[22px] shrink-0 justify-center ${isActive ? "text-accent" : ""}`}>
        <Icon size={17} />
      </span>
      <span className="min-w-0 truncate">{item.label}</span>
      <UpdateDot page={updatePageForPath(item.to)} className="ml-auto"/>
    </SectionLink>
  );
}

export function Sidebar({ changelogVersion }: { changelogVersion: string | null }) {
  return (
    <aside className="site-sidebar sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-sidebar lg:flex">
      <Link to="/" className="mb-2 flex min-h-[56px] flex-col items-start justify-center gap-2 px-1 text-ink" aria-label={`${SITE.name} 首页`}>
        <Wordmark size={24} />
        <span className="text-[14px] font-semibold leading-5">{SITE.name}</span>
      </Link>
      <QuickSearch />
      <nav className="-mx-1 flex-1 overflow-y-auto px-1" aria-label="主导航">
        {SIDEBAR.map((section, sectionIndex) => (
          <section key={section.title} aria-label={section.title} className={sectionIndex?"mt-2 border-t border-line pt-2":"pt-1"}>
            <h2 className="sr-only">{section.title}</h2>
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => (
                <SideLink key={item.to} item={item} />
              ))}
            </div>
          </section>
        ))}
      </nav>
      <div className="mt-2 space-y-2.5 px-1 pt-1">
        <AssistantEntry />
        <ThemeSwitch className="mx-1" />
        {SITE.icp && (
          <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" className="block px-2 text-[10px] text-ink-4 hover:text-ink-3">
            {SITE.icp}
          </a>
        )}
      </div>
    </aside>
  );
}
