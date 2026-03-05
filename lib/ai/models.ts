// CustomGPT powers all AI — model selection is managed on the CustomGPT platform.
export const DEFAULT_CHAT_MODEL = "customgpt/agent";

export type ChatModel = {
  id: string;
  name: string;
  provider: string;
  description: string;
};

export const chatModels: ChatModel[] = [
  {
    id: "customgpt/agent",
    name: "CustomGPT Agent",
    provider: "customgpt",
    description: "Your knowledge-base powered AI agent",
  },
];

// Group models by provider for UI
export const allowedModelIds = new Set(chatModels.map((m) => m.id));

export const modelsByProvider = chatModels.reduce(
  (acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = [];
    }
    acc[model.provider].push(model);
    return acc;
  },
  {} as Record<string, ChatModel[]>
);
