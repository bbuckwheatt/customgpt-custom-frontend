"use server";

import { type UIMessage } from "ai";
import { cookies } from "next/headers";
import type { VisibilityType } from "@/components/visibility-selector";
import {
  CUSTOMGPT_API_KEY,
  CUSTOMGPT_PROJECT_ID,
  fetchCustomGPTResponse,
} from "@/lib/ai/customgpt";
import {
  deleteMessagesByChatIdAfterTimestamp,
  getMessageById,
  updateChatVisibilityById,
} from "@/lib/db/queries";
import { getTextFromMessage } from "@/lib/utils";

export async function saveChatModelAsCookie(model: string) {
  const cookieStore = await cookies();
  cookieStore.set("chat-model", model);
}

export async function generateTitleFromUserMessage({
  message,
}: {
  message: UIMessage;
}) {
  const userText = getTextFromMessage(message);
  const text = await fetchCustomGPTResponse({
    messages: [
      {
        role: "system",
        content:
          "Generate a short chat title (2-5 words) summarizing the user message. Output ONLY the title text with no punctuation, prefixes, or formatting.",
      },
      { role: "user", content: userText },
    ],
    projectId: CUSTOMGPT_PROJECT_ID,
    apiKey: CUSTOMGPT_API_KEY,
  });
  return text
    .replace(/^[#*"\s]+/, "")
    .replace(/["]+$/, "")
    .trim()
    .slice(0, 80);
}

export async function deleteTrailingMessages({ id }: { id: string }) {
  const [message] = await getMessageById({ id });

  await deleteMessagesByChatIdAfterTimestamp({
    chatId: message.chatId,
    timestamp: message.createdAt,
  });
}

export async function updateChatVisibility({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: VisibilityType;
}) {
  await updateChatVisibilityById({ chatId, visibility });
}
