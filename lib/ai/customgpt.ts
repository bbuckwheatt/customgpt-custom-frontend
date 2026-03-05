import type { UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { saveDocument } from "@/lib/db/queries";
import type { ChatMessage } from "@/lib/types";
import { generateUUID } from "@/lib/utils";

const CUSTOMGPT_API_BASE = "https://app.customgpt.ai/api/v1";

export const CUSTOMGPT_PROJECT_ID = process.env.CUSTOMGPT_PROJECT_ID ?? "";
export const CUSTOMGPT_API_KEY = process.env.CUSTOMGPT_API_KEY ?? "";

export type ArtifactKind = "text" | "code" | "sheet";

/**
 * These instructions get injected as the system message so CustomGPT knows
 * how to emit artifacts that we can parse and render in the artifact panel.
 *
 * They extend (not replace) the agent's own configured persona.
 */
export const ARTIFACT_INSTRUCTIONS = `
ARTIFACT OUTPUT RULES — follow exactly:
When producing substantial content (code, documents, spreadsheets >10 lines), wrap it in XML artifact tags:

Code:
<artifact type="code" language="python" title="Descriptive Title">
...code...
</artifact>

Text document / essay / email:
<artifact type="text" title="Descriptive Title">
...content...
</artifact>

Spreadsheet / CSV table:
<artifact type="sheet" title="Descriptive Title">
...csv data...
</artifact>

Rules:
- Maximum ONE artifact per response
- Put any explanation or commentary AFTER the closing </artifact> tag
- Short inline examples do NOT need artifact tags
- Always include a descriptive title attribute
`;

/**
 * Streams text from CustomGPT to the UI in real-time, detecting <artifact>
 * blocks inline as they arrive so artifact content is streamed live rather
 * than delivered in a burst after the full response completes.
 *
 * Phases:
 *  plain    → stream text deltas, watch for <artifact
 *  open-tag → buffer <artifact ...> until >, parse attrs, emit open events
 *  content  → stream artifact deltas, watch for </artifact>
 *  done     → stream any trailing text after </artifact>
 */
export async function streamCustomGPTToDataStream({
  messages,
  projectId = CUSTOMGPT_PROJECT_ID,
  apiKey = CUSTOMGPT_API_KEY,
  signal,
  dataStream,
  session,
}: {
  messages: Array<{ role: string; content: string }>;
  projectId?: string;
  apiKey?: string;
  signal?: AbortSignal;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  session: Session;
}): Promise<string> {
  const response = await fetch(
    `${CUSTOMGPT_API_BASE}/projects/${projectId}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ messages, stream: true }),
      signal,
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`CustomGPT API error ${response.status}: ${text}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body from CustomGPT");

  const ARTIFACT_OPEN = "<artifact";
  const ARTIFACT_CLOSE = "</artifact>";
  const decoder = new TextDecoder();
  let sseBuf = "";
  let accumulated = "";

  // ── Text streaming ──────────────────────────────────────────────────────
  const textId = generateUUID();
  let textStarted = false;

  const emitText = (text: string) => {
    if (!text) return;
    if (!textStarted) {
      dataStream.write({ type: "text-start", id: textId });
      textStarted = true;
    }
    dataStream.write({ type: "text-delta", delta: text, id: textId });
  };

  // ── Artifact streaming ──────────────────────────────────────────────────
  type Phase = "plain" | "open-tag" | "content" | "done";
  let phase: Phase = "plain";
  let held = "";       // plain-phase hold-back for potential <artifact prefix
  let openTagBuf = ""; // accumulates <artifact ...> until >
  let closeBuf = "";   // content-phase lookahead for </artifact>
  let artifactKind: ArtifactKind = "text";
  let artifactTitle = "";
  let artifactDocId = "";
  let artifactContent = ""; // accumulates full content for DB save

  const getDeltaType = (): "data-textDelta" | "data-codeDelta" | "data-sheetDelta" =>
    artifactKind === "code"
      ? "data-codeDelta"
      : artifactKind === "sheet"
        ? "data-sheetDelta"
        : "data-textDelta";

  const emitContentDelta = (text: string) => {
    if (!text) return;
    for (const word of text.split(/(?<=\s)/)) {
      dataStream.write({ type: getDeltaType(), data: word, transient: true });
    }
    artifactContent += text;
  };

  // Stream artifact content, holding back enough to detect </artifact>
  const processContentChunk = (chunk: string) => {
    closeBuf += chunk;

    const closeIdx = closeBuf.indexOf(ARTIFACT_CLOSE);
    if (closeIdx !== -1) {
      if (closeIdx > 0) emitContentDelta(closeBuf.slice(0, closeIdx));
      const afterClose = closeBuf.slice(closeIdx + ARTIFACT_CLOSE.length).trim();
      closeBuf = "";
      phase = "done";
      if (afterClose) emitText(afterClose);
      return;
    }

    // Hold back enough to detect a partial </artifact> match at the tail
    let safeTo = closeBuf.length;
    for (let i = Math.min(closeBuf.length, ARTIFACT_CLOSE.length - 1); i >= 1; i--) {
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

  // Accumulate opening tag until >, then parse attrs and start artifact
  const processOpenTagChunk = (chunk: string) => {
    openTagBuf += chunk;
    const gtIdx = openTagBuf.indexOf(">");
    if (gtIdx === -1) return;

    const tag = openTagBuf.slice(0, gtIdx + 1);
    const rest = openTagBuf.slice(gtIdx + 1);
    openTagBuf = "";

    const typeMatch = /type="(text|code|sheet)"/.exec(tag);
    const titleMatch = /title="([^"]*)"/.exec(tag);
    artifactKind = (typeMatch?.[1] ?? "text") as ArtifactKind;
    artifactTitle = titleMatch?.[1]?.trim() ?? "";
    artifactDocId = generateUUID();

    const fallbackTitle =
      artifactKind === "code" ? "Code Snippet"
      : artifactKind === "sheet" ? "Spreadsheet"
      : "Document";

    dataStream.write({ type: "data-kind", data: artifactKind, transient: true });
    dataStream.write({ type: "data-id", data: artifactDocId, transient: true });
    dataStream.write({ type: "data-title", data: artifactTitle || fallbackTitle, transient: true });
    dataStream.write({ type: "data-clear", data: null, transient: true });

    phase = "content";
    if (rest) processContentChunk(rest);
  };

  // Route each incoming chunk to the appropriate phase handler
  const handleChunk = (delta: string) => {
    accumulated += delta;

    if (phase === "done") { emitText(delta); return; }
    if (phase === "content") { processContentChunk(delta); return; }
    if (phase === "open-tag") { processOpenTagChunk(delta); return; }

    // phase === "plain": stream text, watch for <artifact
    held += delta;
    const idx = held.indexOf(ARTIFACT_OPEN);
    if (idx !== -1) {
      if (idx > 0) emitText(held.slice(0, idx));
      const rest = held.slice(idx);
      held = "";
      phase = "open-tag";
      processOpenTagChunk(rest);
      return;
    }

    // Hold back potential partial <artifact prefix
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

  // ── SSE reading loop ────────────────────────────────────────────────────
  outer: while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuf += decoder.decode(value, { stream: true });
    const lines = sseBuf.split("\n");
    sseBuf = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const payload = trimmed.slice(6);
      if (payload === "[DONE]") break outer;

      try {
        const chunk = JSON.parse(payload);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === "string") handleChunk(delta);
      } catch {
        // skip malformed chunks
      }
    }
  }

  // ── Flush remaining buffers ─────────────────────────────────────────────
  if (phase === "plain" && held) emitText(held);
  // Stream ended mid-artifact without </artifact> — emit whatever we have
  if (phase === "content" && closeBuf) emitContentDelta(closeBuf);

  if (textStarted) {
    dataStream.write({ type: "text-end", id: textId });
  }

  // ── Finalize artifact ───────────────────────────────────────────────────
  if (phase === "content" || phase === "done") {
    if (!artifactTitle) artifactTitle = deriveTitle(artifactContent, artifactKind);
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

  return accumulated;
}

/**
 * Streams from CustomGPT's OpenAI-compatible endpoint and collects the full
 * response as a string. Used for non-streaming calls (e.g. title generation).
 */
export async function fetchCustomGPTResponse({
  messages,
  projectId = CUSTOMGPT_PROJECT_ID,
  apiKey = CUSTOMGPT_API_KEY,
  signal,
}: {
  messages: Array<{ role: string; content: string }>;
  projectId?: string;
  apiKey?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const response = await fetch(
    `${CUSTOMGPT_API_BASE}/projects/${projectId}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ messages, stream: true }),
      signal,
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`CustomGPT API error ${response.status}: ${text}`);
  }

  return readSSEStream(response);
}

/** Reads an OpenAI-format SSE stream and returns the concatenated content. */
async function readSSEStream(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body from CustomGPT");

  const decoder = new TextDecoder();
  let lineBuf = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    lineBuf += decoder.decode(value, { stream: true });
    const lines = lineBuf.split("\n");
    lineBuf = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;

      const payload = trimmed.slice(6);
      if (payload === "[DONE]") return fullText;

      try {
        const chunk = JSON.parse(payload);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === "string") fullText += delta;
      } catch {
        // skip malformed chunks
      }
    }
  }

  return fullText;
}

/** Writes a text string as text-start → text-delta(s) → text-end events. */
function writeTextChunk(
  dataStream: UIMessageStreamWriter<ChatMessage>,
  text: string
) {
  const textId = generateUUID();
  dataStream.write({ type: "text-start", id: textId });

  const tokens = text.split(/(?<=\s)/);
  for (const token of tokens) {
    dataStream.write({ type: "text-delta", delta: token, id: textId });
  }

  dataStream.write({ type: "text-end", id: textId });
}

/**
 * Converts UI messages to the simple role/content format CustomGPT expects.
 * Strips tool invocation parts (artifact panels) — only text is sent.
 */
export function uiMessagesToCustomGPT(
  messages: Array<{
    role: string;
    parts: Array<{ type: string; text?: string }>;
  }>
): Array<{ role: string; content: string }> {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role,
      content: m.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join(""),
    }))
    .filter((m) => m.content.trim().length > 0);
}

function deriveTitle(content: string, kind: ArtifactKind): string {
  const first = content.split("\n")[0]?.trim() ?? "";
  if (kind === "code") {
    return first.startsWith("#")
      ? first.replace(/^#+\s*/, "")
      : "Code Snippet";
  }
  if (kind === "sheet") return "Spreadsheet";
  return first.length > 0 && first.length <= 60 ? first : "Document";
}
