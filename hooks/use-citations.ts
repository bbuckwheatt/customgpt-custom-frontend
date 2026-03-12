"use client";

import { useCallback, useContext } from "react";
import useSWR from "swr";
import type { Citation } from "@/lib/ai/customgpt";
import { ArtifactChatContext } from "./use-artifact";

function useCitationsKey() {
  const chatId = useContext(ArtifactChatContext);
  return chatId ? `citations-${chatId}` : "citations";
}

export function useCitations() {
  const key = useCitationsKey();

  const { data: citations, mutate } = useSWR<Citation[]>(key, null, {
    fallbackData: [],
  });

  const setCitations = useCallback(
    (newCitations: Citation[]) => {
      mutate(newCitations, { revalidate: false });
    },
    [mutate]
  );

  return {
    citations: citations ?? [],
    setCitations,
  };
}
