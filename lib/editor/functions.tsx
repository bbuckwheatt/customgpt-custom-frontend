"use client";

import {
  defaultMarkdownParser,
  defaultMarkdownSerializer,
} from "prosemirror-markdown";
import type { Node } from "prosemirror-model";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";

import { documentSchema } from "./config";
import { createSuggestionWidget, type UISuggestion } from "./suggestions";

export const buildDocumentFromContent = (content: string) => {
  try {
    // Parse the markdown text using the default parser (synchronous, no React needed),
    // then convert to our documentSchema via JSON round-trip. Both schemas share the
    // same node/mark type names, so this is safe.
    const parsed = defaultMarkdownParser.parse(content);
    if (parsed) {
      return documentSchema.nodeFromJSON(parsed.toJSON());
    }
  } catch {
    // fall through to empty doc
  }
  return documentSchema.topNodeType.createAndFill()!;
};

export const buildContentFromDocument = (document: Node) => {
  return defaultMarkdownSerializer.serialize(document);
};

export const createDecorations = (
  suggestions: UISuggestion[],
  view: EditorView
) => {
  const decorations: Decoration[] = [];

  for (const suggestion of suggestions) {
    decorations.push(
      Decoration.inline(
        suggestion.selectionStart,
        suggestion.selectionEnd,
        {
          class: "suggestion-highlight",
        },
        {
          suggestionId: suggestion.id,
          type: "highlight",
        }
      )
    );

    decorations.push(
      Decoration.widget(
        suggestion.selectionStart,
        (currentView) => {
          const { dom } = createSuggestionWidget(suggestion, currentView);
          return dom;
        },
        {
          suggestionId: suggestion.id,
          type: "widget",
        }
      )
    );
  }

  return DecorationSet.create(view.state.doc, decorations);
};
