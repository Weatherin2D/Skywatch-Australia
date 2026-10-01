import { WarningDetailPage } from "@/components/warnings/warning-detail-page";

export const dynamic = "force-dynamic";

export default async function WarningByIdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WarningDetailPage id={id} />;
}
