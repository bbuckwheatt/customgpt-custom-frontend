"use server";

import type { UIMessage } from "ai";
import { cookies } from "next/headers";
import { auth } from "@/app/(auth)/auth";
import type { VisibilityType } from "@/components/visibility-selector";
import {
  deleteMessagesByChatIdAfterTimestamp,
  getChatById,
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
  // Derive title from first line of user message — no API call needed.
  const firstLine = userText.split("\n")[0]?.trim() ?? "";
  const title =
    firstLine.length > 50 ? `${firstLine.slice(0, 47)}...` : firstLine;
  return title || "New chat";
}

export async function deleteTrailingMessages({ id }: { id: string }) {
  const session = await auth();
  if (!session?.user) {
    return;
  }

  const [message] = await getMessageById({ id });
  if (!message) {
    return;
  }

  const chat = await getChatById({ id: message.chatId });
  if (chat?.userId !== session.user.id) {
    return;
  }

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
  const session = await auth();
  if (!session?.user) {
    return;
  }

  const chat = await getChatById({ id: chatId });
  if (chat?.userId !== session.user.id) {
    return;
  }

  await updateChatVisibilityById({ chatId, visibility });
}
