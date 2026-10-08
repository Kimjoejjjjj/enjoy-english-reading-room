"use client";

import { useParams } from "next/navigation";
import HighlightsManager from "@/components/reader/HighlightsManager";

export default function BookHighlightsPage() {
  const { id } = useParams<{ id: string }>();
  return <HighlightsManager contentId={id} />;
}
