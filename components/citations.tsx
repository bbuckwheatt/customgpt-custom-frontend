"use client";

import { ExternalLinkIcon, FileTextIcon } from "lucide-react";
import { useState } from "react";
import type { Citation } from "@/lib/ai/customgpt";
import { cn } from "@/lib/utils";

export function Citations({ citations }: { citations: Citation[] }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!citations.length) {
    return null;
  }

  const visibleCitations = isExpanded ? citations : citations.slice(0, 3);
  const hasMore = citations.length > 3;

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <button
        className="flex items-center gap-1.5 text-muted-foreground text-xs font-medium hover:text-foreground transition-colors w-fit"
        onClick={() => setIsExpanded(!isExpanded)}
        type="button"
      >
        <FileTextIcon size={12} />
        <span>
          {citations.length} source{citations.length !== 1 ? "s" : ""}
        </span>
      </button>

      <div className="flex flex-col gap-1">
        {visibleCitations.map((citation, index) => (
          <CitationItem
            citation={citation}
            index={index}
            key={citation.url || index}
          />
        ))}
      </div>

      {hasMore && !isExpanded && (
        <button
          className="text-muted-foreground text-xs hover:text-foreground transition-colors w-fit"
          onClick={() => setIsExpanded(true)}
          type="button"
        >
          +{citations.length - 3} more
        </button>
      )}
    </div>
  );
}

function CitationItem({
  citation,
  index,
}: {
  citation: Citation;
  index: number;
}) {
  const displayUrl = citation.url
    ? new URL(citation.url).hostname.replace(/^www\./, "")
    : null;

  const content = (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
        citation.url ? "hover:bg-muted cursor-pointer" : "bg-muted/50"
      )}
    >
      <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">
          {citation.title || displayUrl || "Source"}
        </div>
        {displayUrl && citation.title && (
          <div className="truncate text-muted-foreground">{displayUrl}</div>
        )}
      </div>
      {citation.url && (
        <ExternalLinkIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
      )}
    </div>
  );

  if (citation.url) {
    return (
      <a href={citation.url} rel="noopener noreferrer" target="_blank">
        {content}
      </a>
    );
  }

  return content;
}
