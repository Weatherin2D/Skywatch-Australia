import { HomeDashboard } from "@/components/home/home-dashboard";
import { SiteShell } from "@/components/site/site-shell";

export default function SatellitePage() {
  return (
    <SiteShell>
      <HomeDashboard focus="satellite" />
    </SiteShell>
  );
}
