"use client";

import { useCallback, useContext } from "react";
import useSWR from "swr";
import type { Citation } from "@/lib/ai/customgpt";
import { ArtifactChatContext } from "./use-artifact";

type CitationsState = {
  messageId: string;
  citations: Citation[];
};

const emptyCitations: CitationsState = { messageId: "", citations: [] };

function useCitationsKey() {
  const chatId = useContext(ArtifactChatContext);
  return chatId ? `citations-${chatId}` : "citations";
}

export function useCitations() {
  const key = useCitationsKey();

  const { data, mutate } = useSWR<CitationsState>(key, null, {
    fallbackData: emptyCitations,
  });

  const setCitations = useCallback(
    (state: CitationsState) => {
      mutate(state, { revalidate: false });
    },
    [mutate]
  );

  const clearCitations = useCallback(() => {
    mutate(emptyCitations, { revalidate: false });
  }, [mutate]);

  return {
    citationsMessageId: data?.messageId ?? "",
    citations: data?.citations ?? [],
    setCitations,
    clearCitations,
  };
}
