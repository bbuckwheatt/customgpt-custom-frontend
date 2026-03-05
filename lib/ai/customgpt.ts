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
 * Streams text from CustomGPT to the UI in real-time while detecting and
 * buffering <artifact> blocks (which are processed after the stream closes).
 *
 * - Text before any <artifact> tag → text-start / text-delta events in real-time
 * - <artifact>...</artifact>       → buffered, then emitted as data-* artifact events
 * - Text after </artifact>         → emitted as text-delta events after artifact
 *
 * Returns the full accumulated response text.
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
  const decoder = new TextDecoder();
  let sseBuf = "";
  let accumulated = "";

  // Text streaming state
  const textId = generateUUID();
  let textStarted = false;
  // Text held back to check whether it's the beginning of an <artifact tag
  let held = "";
  // Once we see <artifact, stop flushing text immediately
  let artifactMode = false;

  const emitText = (text: string) => {
    if (!text) return;
    if (!textStarted) {
      dataStream.write({ type: "text-start", id: textId });
      textStarted = true;
    }
    dataStream.write({ type: "text-delta", delta: text, id: textId });
  };

  /**
   * Tries to flush as much of `held` as possible as text-delta events,
   * while keeping back any suffix that could be the start of "<artifact".
   */
  const tryFlush = (incoming: string) => {
    if (artifactMode) return;
    held += incoming;

    // Check for a complete <artifact opening in what we've buffered
    const idx = held.indexOf(ARTIFACT_OPEN);
    if (idx !== -1) {
      const before = held.slice(0, idx);
      if (before) emitText(before);
      held = "";
      artifactMode = true;
      return;
    }

    // Check if the tail of `held` is a partial prefix of ARTIFACT_OPEN.
    // If so, keep that suffix buffered; flush everything before it.
    let safeTo = held.length;
    for (
      let i = Math.min(held.length, ARTIFACT_OPEN.length - 1);
      i >= 1;
      i--
    ) {
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
        if (typeof delta === "string") {
          accumulated += delta;
          tryFlush(delta);
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  // Flush any remaining held text (only possible when no artifact was found)
  if (!artifactMode && held) {
    emitText(held);
  }

  if (textStarted) {
    dataStream.write({ type: "text-end", id: textId });
  }

  // --- Post-stream artifact processing ---
  const artifactRe =
    /<artifact\s+type="(text|code|sheet)"(?:\s+language="([^"]*)")?(?:\s+title="([^"]*)")?[^>]*>([\s\S]*?)<\/artifact>/i;
  const match = artifactRe.exec(accumulated);

  if (match) {
    const [fullMatch, rawType, , rawTitle, rawContent] = match;
    const afterArtifact = accumulated.slice(match.index + fullMatch.length).trim();

    const kind = rawType as ArtifactKind;
    const content = rawContent.trim();
    const title = rawTitle?.trim() || deriveTitle(content, kind);
    const docId = generateUUID();

    dataStream.write({ type: "data-kind", data: kind, transient: true });
    dataStream.write({ type: "data-id", data: docId, transient: true });
    dataStream.write({ type: "data-title", data: title, transient: true });
    dataStream.write({ type: "data-clear", data: null, transient: true });

    const deltaType =
      kind === "code"
        ? "data-codeDelta"
        : kind === "sheet"
          ? "data-sheetDelta"
          : "data-textDelta";

    for (const word of content.split(/(?<=\s)/)) {
      dataStream.write({ type: deltaType, data: word, transient: true });
    }

    if (session?.user?.id) {
      await saveDocument({ id: docId, title, content, kind, userId: session.user.id });
    }

    dataStream.write({ type: "data-finish", data: null, transient: true });

    if (afterArtifact) {
      writeTextChunk(dataStream, afterArtifact);
    }
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
