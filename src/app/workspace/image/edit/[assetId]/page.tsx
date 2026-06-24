import { FluxArtShell } from "@/features/flux-art/flux-art-shell";

interface ImageEditPageProps {
  params: Promise<{ assetId: string }>;
}

export default async function ImageEditPage({ params }: ImageEditPageProps) {
  const { assetId } = await params;
  return <FluxArtShell activePage="edit" initialAssetId={assetId} />;
}
