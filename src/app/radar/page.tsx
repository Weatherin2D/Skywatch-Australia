import { HomeDashboard } from "@/components/home/home-dashboard";
import { SiteShell } from "@/components/site/site-shell";

export default function RadarPage() {
  return (
    <SiteShell>
      <HomeDashboard focus="radar" />
    </SiteShell>
  );
}
