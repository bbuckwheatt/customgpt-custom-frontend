import type { UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { saveDocument } from "@/lib/db/queries";
import type { ChatMessage } from "@/lib/types";
import { generateUUID } from "@/lib/utils";

const CUSTOMGPT_API_BASE = "https://app.customgpt.ai/api/v1";

export const CUSTOMGPT_PROJECT_ID = process.env.CUSTOMGPT_PROJECT_ID ?? "";
export const CUSTOMGPT_API_KEY = process.env.CUSTOMGPT_API_KEY ?? "";

export type ArtifactKind = "text" | "code" | "sheet";

export type Citation = {
  title: string;
  url: string;
  source_url?: string;
  snippet?: string;
};

export type StreamResult = {
  accumulated: string;
  citations: Citation[];
};

/**
 * Artifact output instructions sent via custom_context per message
 * so CustomGPT knows how to emit artifacts we can parse and render.
 */
export const ARTIFACT_INSTRUCTIONS = `For substantial content (>10 lines), use artifact tags:
Code: <artifact type="code" language="python" title="Title">code</artifact>
Text: <artifact type="text" title="Title">content</artifact>
Sheet: <artifact type="sheet" title="Title">csv</artifact>
Max ONE artifact per response. Commentary goes AFTER </artifact>. Short inline examples need no tags. Always include title.`;

/**
 * Creates a new conversation in CustomGPT and returns the session ID.
 */
export async function createConversation({
  projectId = CUSTOMGPT_PROJECT_ID,
  apiKey = CUSTOMGPT_API_KEY,
  name,
}: {
  projectId?: string;
  apiKey?: string;
  name?: string;
} = {}): Promise<string> {
  const response = await fetch(
    `${CUSTOMGPT_API_BASE}/projects/${projectId}/conversations`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: name ?? "New chat" }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `CustomGPT create conversation error ${response.status}: ${text}`
    );
  }

  const json = await response.json();
  const sessionId = json?.data?.session_id;
  if (!sessionId) {
    throw new Error("No session_id returned from CustomGPT conversation API");
  }
  return sessionId;
}

/**
 * Streams text from CustomGPT's native conversation API to the UI in
 * real-time, detecting <artifact> blocks inline as they arrive.
 *
 * Uses: POST /projects/{projectId}/conversations/{sessionId}/messages?stream=true
 *
 * SSE format:
 *   event: start    → {"status":"start","prompt":"..."}
 *   event: progress → {"status":"progress","message":"..."} (text delta)
 *   event: finish   → {"status":"finish","id":...,"session_id":"...","citations":[]}
 */
export async function streamCustomGPTToDataStream({
  message,
  sessionId,
  projectId = CUSTOMGPT_PROJECT_ID,
  apiKey = CUSTOMGPT_API_KEY,
  signal,
  dataStream,
  session,
}: {
  message: string;
  sessionId: string;
  projectId?: string;
  apiKey?: string;
  signal?: AbortSignal;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  session: Session;
}): Promise<StreamResult> {
  const url = new URL(
    `${CUSTOMGPT_API_BASE}/projects/${projectId}/conversations/${sessionId}/messages`
  );
  url.searchParams.set("stream", "true");

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      prompt: message,
      custom_context: ARTIFACT_INSTRUCTIONS,
    }),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`CustomGPT API error ${response.status}: ${text}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body from CustomGPT");
  }

  const ARTIFACT_OPEN = "<artifact";
  const ARTIFACT_CLOSE = "</artifact>";
  const decoder = new TextDecoder();
  let sseBuf = "";
  let accumulated = "";

  // ── Text streaming ──────────────────────────────────────────────────────
  const textId = generateUUID();
  let textStarted = false;

  // Queue of text chunks to drip out with small delays so the browser
  // renders incrementally even when CustomGPT sends big batches.
  const textQueue: string[] = [];
  let dripping = false;

  const drip = async () => {
    if (dripping) {
      return;
    }
    dripping = true;
    while (textQueue.length > 0) {
      const word = textQueue.shift()!;
      dataStream.write({ type: "text-delta", delta: word, id: textId });
      // Tiny yield so each write flushes as its own SSE event
      await new Promise((r) => setTimeout(r, 5));
    }
    dripping = false;
  };

  const emitText = (text: string) => {
    if (!text) {
      return;
    }
    if (!textStarted) {
      dataStream.write({ type: "text-start", id: textId });
      textStarted = true;
    }
    for (const word of text.split(/(?<=\s)/)) {
      if (word) {
        textQueue.push(word);
      }
    }
    drip();
  };

  // Wait for all queued text to flush before finishing the stream.
  const flushText = async () => {
    while (textQueue.length > 0 || dripping) {
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  // ── Artifact streaming ──────────────────────────────────────────────────
  type Phase = "plain" | "open-tag" | "content" | "done";
  let phase: Phase = "plain";
  let held = "";
  let openTagBuf = "";
  let closeBuf = "";
  let artifactKind: ArtifactKind = "text";
  let artifactTitle = "";
  let artifactDocId = "";
  let artifactContent = "";

  const getDeltaType = ():
    | "data-textDelta"
    | "data-codeDelta"
    | "data-sheetDelta" =>
    artifactKind === "code"
      ? "data-codeDelta"
      : artifactKind === "sheet"
        ? "data-sheetDelta"
        : "data-textDelta";

  const emitContentDelta = (text: string) => {
    if (!text) {
      return;
    }
    for (const word of text.split(/(?<=\s)/)) {
      dataStream.write({ type: getDeltaType(), data: word, transient: true });
    }
    artifactContent += text;
  };

  const processContentChunk = (chunk: string) => {
    closeBuf += chunk;

    const closeIdx = closeBuf.indexOf(ARTIFACT_CLOSE);
    if (closeIdx !== -1) {
      if (closeIdx > 0) {
        emitContentDelta(closeBuf.slice(0, closeIdx));
      }
      const afterClose = closeBuf
        .slice(closeIdx + ARTIFACT_CLOSE.length)
        .trim();
      closeBuf = "";
      phase = "done";
      if (afterClose) {
        emitText(afterClose);
      }
      return;
    }

    let safeTo = closeBuf.length;
    for (
      let i = Math.min(closeBuf.length, ARTIFACT_CLOSE.length - 1);
      i >= 1;
      i--
    ) {
      if (ARTIFACT_CLOSE.startsWith(closeBuf.slice(-i))) {
        safeTo = closeBuf.length - i;
        break;
      }
    }
    if (safeTo > 0) {
      emitContentDelta(closeBuf.slice(0, safeTo));
      closeBuf = closeBuf.slice(safeTo);
    }
  };

  const processOpenTagChunk = (chunk: string) => {
    openTagBuf += chunk;
    const gtIdx = openTagBuf.indexOf(">");
    if (gtIdx === -1) {
      return;
    }

    const tag = openTagBuf.slice(0, gtIdx + 1);
    const rest = openTagBuf.slice(gtIdx + 1);
    openTagBuf = "";

    const typeMatch = /type="(text|code|sheet)"/.exec(tag);
    const titleMatch = /title="([^"]*)"/.exec(tag);
    artifactKind = (typeMatch?.[1] ?? "text") as ArtifactKind;
    artifactTitle = titleMatch?.[1]?.trim() ?? "";
    artifactDocId = generateUUID();

    const fallbackTitle =
      artifactKind === "code"
        ? "Code Snippet"
        : artifactKind === "sheet"
          ? "Spreadsheet"
          : "Document";

    dataStream.write({
      type: "data-kind",
      data: artifactKind,
      transient: true,
    });
    dataStream.write({ type: "data-id", data: artifactDocId, transient: true });
    dataStream.write({
      type: "data-title",
      data: artifactTitle || fallbackTitle,
      transient: true,
    });
    dataStream.write({ type: "data-clear", data: null, transient: true });

    phase = "content";
    if (rest) {
      processContentChunk(rest);
    }
  };

  const handleChunk = (delta: string) => {
    accumulated += delta;

    if (phase === "done") {
      emitText(delta);
      return;
    }
    if (phase === "content") {
      processContentChunk(delta);
      return;
    }
    if (phase === "open-tag") {
      processOpenTagChunk(delta);
      return;
    }

    held += delta;
    const idx = held.indexOf(ARTIFACT_OPEN);
    if (idx !== -1) {
      if (idx > 0) {
        emitText(held.slice(0, idx));
      }
      const rest = held.slice(idx);
      held = "";
      phase = "open-tag";
      processOpenTagChunk(rest);
      return;
    }

    let safeTo = held.length;
    for (let i = Math.min(held.length, ARTIFACT_OPEN.length - 1); i >= 1; i--) {
      if (ARTIFACT_OPEN.startsWith(held.slice(-i))) {
        safeTo = held.length - i;
        break;
      }
    }
    if (safeTo > 0) {
      emitText(held.slice(0, safeTo));
      held = held.slice(safeTo);
    }
  };

  // ── SSE reading loop (native CustomGPT format) ─────────────────────────
  let currentEvent = "";
  let citationIds: number[] = [];
  outer: while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    sseBuf += decoder.decode(value, { stream: true });
    const lines = sseBuf.split("\n");
    sseBuf = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith("event: ")) {
        currentEvent = trimmed.slice(7);
        continue;
      }

      if (!trimmed.startsWith("data: ")) {
        continue;
      }

      const payload = trimmed.slice(6);

      try {
        const chunk = JSON.parse(payload);

        if (currentEvent === "finish" || chunk.status === "finish") {
          // Citation IDs to resolve after streaming
          if (Array.isArray(chunk.citations) && chunk.citations.length > 0) {
            citationIds = chunk.citations as number[];
          }
          break outer;
        }

        if (
          (currentEvent === "progress" || chunk.status === "progress") &&
          typeof chunk.message === "string"
        ) {
          handleChunk(chunk.message);
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  // ── Flush remaining buffers ─────────────────────────────────────────────
  const finalPhase = phase as Phase;
  if (finalPhase === "plain" && held) {
    emitText(held);
  }
  if (finalPhase === "content" && closeBuf) {
    emitContentDelta(closeBuf);
  }

  await flushText();

  if (textStarted) {
    dataStream.write({ type: "text-end", id: textId });
  }

  // ── Finalize artifact ───────────────────────────────────────────────────
  if (finalPhase === "content" || finalPhase === "done") {
    if (!artifactTitle) {
      artifactTitle = deriveTitle(artifactContent, artifactKind);
    }
    if (session?.user?.id) {
      await saveDocument({
        id: artifactDocId,
        title: artifactTitle,
        content: artifactContent,
        kind: artifactKind,
        userId: session.user.id,
      });
    }
    dataStream.write({ type: "data-finish", data: null, transient: true });
  }

  // ── Fetch and emit citations ────────────────────────────────────────
  const citations = await fetchCitationMetadata(citationIds, projectId, apiKey);
  if (citations.length > 0) {
    dataStream.write({ type: "data-citations", data: citations });
  }

  return { accumulated, citations };
}

/**
 * Extracts the text content from the last user message in UI format.
 */
export function getLastUserMessageText(
  messages: Array<{
    role: string;
    parts: Array<{ type: string; text?: string }>;
  }>
): string {
  const userMessages = messages.filter((m) => m.role === "user");
  const last = userMessages.at(-1);
  if (!last) {
    return "";
  }
  return last.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

/**
 * Fetches citation metadata from CustomGPT for each citation ID.
 * The finish event only returns IDs; we hit the citation endpoint to get
 * the title, URL, and other metadata for each one.
 */
async function fetchCitationMetadata(
  citationIds: number[],
  projectId: string,
  apiKey: string
): Promise<Citation[]> {
  if (citationIds.length === 0) {
    return [];
  }

  const results = await Promise.allSettled(
    citationIds.map(async (id) => {
      const response = await fetch(
        `${CUSTOMGPT_API_BASE}/projects/${projectId}/citations/${id}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
          },
        }
      );

      if (!response.ok) {
        console.error(`Citation fetch failed for ID ${id}: ${response.status}`);
        return null;
      }

      const json = await response.json();
      // Log first citation response to discover the schema
      if (citationIds.indexOf(id) === 0) {
        console.log(
          "Citation metadata response:",
          JSON.stringify(json, null, 2)
        );
      }

      const data = json?.data ?? json;
      const citation: Citation = {
        title: String(data.title ?? data.name ?? ""),
        url: String(data.url ?? data.source_url ?? data.link ?? ""),
      };
      if (data.source_url) {
        citation.source_url = String(data.source_url);
      }
      if (data.snippet) {
        citation.snippet = String(data.snippet);
      } else if (data.description) {
        citation.snippet = String(data.description);
      }
      return citation;
    })
  );

  return results
    .filter(
      (r): r is PromiseFulfilledResult<Citation | null> =>
        r.status === "fulfilled"
    )
    .map((r) => r.value)
    .filter((c): c is Citation => c !== null && Boolean(c.title || c.url));
}

function deriveTitle(content: string, kind: ArtifactKind): string {
  const first = content.split("\n")[0]?.trim() ?? "";
  if (kind === "code") {
    return first.startsWith("#") ? first.replace(/^#+\s*/, "") : "Code Snippet";
  }
  if (kind === "sheet") {
    return "Spreadsheet";
  }
  return first.length > 0 && first.length <= 60 ? first : "Document";
}
