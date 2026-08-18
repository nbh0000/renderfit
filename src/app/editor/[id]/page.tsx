import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { EditorShell } from "@/components/editor/EditorShell";
import { getViewer } from "@/lib/auth";
import { loadProject } from "@/services/projectService";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const viewer = await getViewer();
  const loaded = await loadProject(id, viewer.userId);
  return { title: loaded ? `${loaded.project.name} — 편집` : "에디터" };
}

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  if (viewer.configured && !viewer.userId) redirect(`/login?next=/editor/${id}`);

  const loaded = await loadProject(id, viewer.userId);
  if (!loaded) notFound();

  return <EditorShell project={loaded.project} />;
}
