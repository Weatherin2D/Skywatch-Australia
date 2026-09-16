import { HomeDashboard } from "@/components/home/home-dashboard";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { SiteNav } from "@/components/site/site-nav";
import { WarningsBar } from "@/components/site/warnings-bar";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--page)]">
      <SiteHeader />
      <WarningsBar />
      <SiteNav />
      <main className="flex-1">
        <HomeDashboard />
      </main>
      <SiteFooter />
    </div>
  );
}
