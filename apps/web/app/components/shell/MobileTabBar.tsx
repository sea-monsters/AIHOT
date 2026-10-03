import {AssistantEntry} from "../AssistantEntry";
import { Link, useLocation } from "react-router";
import { TABBAR, tabIsActive } from "./nav";
import {UpdateDot,useNavigationUpdates} from "../NavigationUpdates";
import {updatePageForPath,updatePageDestination} from "@aihot/contracts/navigation-updates";

/** Bottom tab bar of the mobile shell (up to 960px), as on the original site. */
export function MobileTabBar({ changelogVersion }: { changelogVersion: string | null }) {
  const { pathname } = useLocation();const {pages}=useNavigationUpdates();
  return (
    <nav aria-label="底部导航" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-sidebar pb-[env(safe-area-inset-bottom)] lg:hidden">
      <div className="mx-auto grid h-[54px] max-w-[640px] grid-cols-5">
        {TABBAR.map((t) => {
          const active = tabIsActive(t, pathname);
          const Icon = t.icon;
          return (
            <Link
              key={t.to}
              to={updatePageDestination(t.to,pages)}
              prefetch="intent"
              aria-current={active ? "page" : undefined}
              className={`relative flex flex-col items-center justify-center gap-[3px] text-[11px] transition-colors ${active ? "bg-selected font-semibold text-accent-ink" : "text-ink-3 active:text-ink"}`}
            >
              <Icon size={21} />
              <span>{t.label}</span>
              <UpdateDot page={updatePageForPath(t.to)} more={t.to==='/more'} className="navigation-mobile-dot"/>
            </Link>
          );
        })}
        <AssistantEntry mobile />
      </div>
    </nav>
  );
}
