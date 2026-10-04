import { AutoCellDetailPage } from "@/components/warnings/auto-cell-detail-page";

export const dynamic = "force-dynamic";

export default async function AutoWarningCellPage({
  params,
}: {
  params: Promise<{ cellId: string }>;
}) {
  const { cellId } = await params;
  return <AutoCellDetailPage cellId={decodeURIComponent(cellId)} />;
}
