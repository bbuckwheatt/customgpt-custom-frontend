import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
} from "ai";
import { checkBotId } from "botid/server";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { auth, type UserType } from "@/app/(auth)/auth";
import {
  CUSTOMGPT_API_KEY,
  CUSTOMGPT_PROJECT_ID,
  createConversation,
  streamCustomGPTToDataStream,
} from "@/lib/ai/customgpt";
import { entitlementsByUserType } from "@/lib/ai/entitlements";

import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  saveChat,
  saveMessages,
  updateChatSessionId,
  updateChatTitleById,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import { generateUUID, getTextFromMessage } from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 60;

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch (_) {
    return null;
  }
}

export { getStreamContext };

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (_) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    const { id, message, selectedVisibilityType } = requestBody;

    const [botResult, session] = await Promise.all([checkBotId(), auth()]);

    if (botResult.isBot) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const userType: UserType = session.user.type;

    const messageCount = await getMessageCountByUserId({
      id: session.user.id,
      differenceInHours: 1,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerHour) {
      return new ChatbotError("rate_limit:chat").toResponse();
    }

    const chat = await getChatById({ id });
    let sessionId: string | null = null;
    let chatTitle: string | null = null;

    if (chat) {
      if (chat.userId !== session.user.id) {
        return new ChatbotError("forbidden:chat").toResponse();
      }
      sessionId = chat.sessionId;

      // Migrate old chats that don't have a session ID yet
      if (!sessionId && message?.role === "user") {
        sessionId = await createConversation({
          projectId: CUSTOMGPT_PROJECT_ID,
          apiKey: CUSTOMGPT_API_KEY,
          name: chat.title,
        });
        await updateChatSessionId({ chatId: id, sessionId });
      }
    } else if (message?.role === "user") {
      // New chat: create a CustomGPT conversation to get a session ID
      sessionId = await createConversation({
        projectId: CUSTOMGPT_PROJECT_ID,
        apiKey: CUSTOMGPT_API_KEY,
        name: "New chat",
      });

      await saveChat({
        id,
        userId: session.user.id,
        title: "New chat",
        visibility: selectedVisibilityType,
        sessionId,
      });

      chatTitle = await generateTitleFromUserMessage({ message });
    }

    if (!sessionId) {
      return new ChatbotError("bad_request:chat").toResponse();
    }

    // Save the incoming user message
    if (message?.role === "user") {
      await saveMessages({
        messages: [
          {
            chatId: id,
            id: message.id,
            role: "user",
            parts: message.parts,
            attachments: [],
            createdAt: new Date(),
          },
        ],
      });
    }

    // Extract the user's message text to send to CustomGPT
    const userText = message ? getTextFromMessage(message) : "";

    const assistantMessageId = generateUUID();

    const stream = createUIMessageStream({
      execute: async ({ writer: dataStream }) => {
        dataStream.write({
          type: "start",
          messageId: assistantMessageId,
        });

        const { accumulated, citations } = await streamCustomGPTToDataStream({
          message: userText,
          sessionId: sessionId!,
          projectId: CUSTOMGPT_PROJECT_ID,
          apiKey: CUSTOMGPT_API_KEY,
          dataStream,
          session,
        });

        dataStream.write({ type: "finish", finishReason: "stop" });

        // Save assistant message immediately after streaming completes
        // (server-side), so it persists even if the client disconnects.
        if (accumulated) {
          const parts: Record<string, unknown>[] = [
            { type: "text", text: accumulated },
          ];
          if (citations.length > 0) {
            parts.push({ type: "citations", citations });
          }

          await saveMessages({
            messages: [
              {
                id: assistantMessageId,
                role: "assistant",
                parts,
                createdAt: new Date(),
                attachments: [],
                chatId: id,
              },
            ],
          });
        }

        // Update the chat title (first message only)
        if (chatTitle) {
          dataStream.write({ type: "data-chat-title", data: chatTitle });
          updateChatTitleById({ chatId: id, title: chatTitle });
        }
      },
      generateId: generateUUID,
      onError: (error) => {
        console.error("Stream error:", error);
        return "Oops, an error occurred! Please try again.";
      },
    });

    return createUIMessageStreamResponse({
      stream,
      async consumeSseStream({ stream: sseStream }) {
        if (!process.env.REDIS_URL) {
          return;
        }
        try {
          const streamContext = getStreamContext();
          if (streamContext) {
            const streamId = generateId();
            await createStreamId({ streamId, chatId: id });
            await streamContext.createNewResumableStream(
              streamId,
              () => sseStream
            );
          }
        } catch (_) {
          // ignore redis errors
        }
      },
    });
  } catch (error) {
    const vercelId = request.headers.get("x-vercel-id");

    if (error instanceof ChatbotError) {
      console.error("ChatbotError in chat API:", error.message);
      return error.toResponse();
    }

    console.error("Unhandled error in chat API:", error, { vercelId });

    return new ChatbotError("offline:chat").toResponse();
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new ChatbotError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
