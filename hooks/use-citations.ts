"use client";

import { useCallback, useContext } from "react";
import useSWR from "swr";
import type { Citation } from "@/lib/ai/customgpt";
import { ArtifactChatContext } from "./use-artifact";

/** Map of messageId → citations, accumulates across the conversation */
type CitationsMap = Record<string, Citation[]>;

const emptyMap: CitationsMap = {};

function useCitationsKey() {
  const chatId = useContext(ArtifactChatContext);
  return chatId ? `citations-${chatId}` : "citations";
}

export function useCitations() {
  const key = useCitationsKey();

  const { data, mutate } = useSWR<CitationsMap>(key, null, {
    fallbackData: emptyMap,
  });

  const map = data ?? emptyMap;

  const setCitations = useCallback(
    (state: { messageId: string; citations: Citation[] }) => {
      mutate(
        (prev) => ({
          ...(prev ?? emptyMap),
          [state.messageId]: state.citations,
        }),
        { revalidate: false }
      );
    },
    [mutate]
  );

  const clearCitations = useCallback(() => {
    mutate(emptyMap, { revalidate: false });
  }, [mutate]);

  return {
    citationsMap: map,
    setCitations,
    clearCitations,
  };
}
