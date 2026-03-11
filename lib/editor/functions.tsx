"use client";

import MarkdownIt from "markdown-it";
import {
  defaultMarkdownSerializer,
  MarkdownParser,
  type MarkdownSerializerState,
} from "prosemirror-markdown";
import type { Node } from "prosemirror-model";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";

import { documentSchema } from "./config";
import { createSuggestionWidget, type UISuggestion } from "./suggestions";

const markdownIt = MarkdownIt("default", { html: false });

const markdownParser = new MarkdownParser(documentSchema, markdownIt, {
  ...Object.fromEntries(
    Object.entries({
      blockquote: { block: "blockquote" },
      paragraph: { block: "paragraph" },
      list_item: { block: "list_item" },
      bullet_list: { block: "bullet_list" },
      ordered_list: {
        block: "ordered_list",
        getAttrs: (tok: { attrGet: (key: string) => string | null }) => ({
          order: Number(tok.attrGet("start") || 1),
        }),
      },
      heading: {
        block: "heading",
        getAttrs: (tok: { attrGet: (key: string) => string | null }) => ({
          level: Number(tok.attrGet("level")),
        }),
      },
      code_block: { block: "code_block", noCloseToken: true },
      fence: {
        block: "code_block",
        getAttrs: (tok: { info: string }) => ({ params: tok.info || "" }),
        noCloseToken: true,
      },
      hr: { node: "horizontal_rule" },
      image: {
        node: "image",
        getAttrs: (tok: {
          attrGet: (key: string) => string | null;
          children?: Array<{ content: string }>;
        }) => ({
          src: tok.attrGet("src"),
          title: tok.attrGet("title") || null,
          alt: tok.children?.[0]?.content || null,
        }),
      },
      hardbreak: { node: "hard_break" },
      em: { mark: "em" },
      strong: { mark: "strong" },
      link: {
        mark: "link",
        getAttrs: (tok: { attrGet: (key: string) => string | null }) => ({
          href: tok.attrGet("href"),
          title: tok.attrGet("title") || null,
        }),
      },
      code_inline: { mark: "code", noCloseToken: true },
    })
  ),
  table: { block: "table" },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: "table_row" },
  th: { block: "table_header" },
  td: { block: "table_cell" },
});

const tableSerializer = {
  table(state: MarkdownSerializerState, node: Node) {
    const rows: Node[] = [];
    // biome-ignore lint/complexity/noForEach: ProseMirror Node.forEach is not iterable
    node.forEach((row) => {
      rows.push(row);
    });
    if (rows.length === 0) {
      return;
    }

    const cellContents: string[][] = [];
    for (const row of rows) {
      const cells: string[] = [];
      // biome-ignore lint/complexity/noForEach: ProseMirror Node.forEach is not iterable
      row.forEach((cell) => {
        cells.push(cell.textContent);
      });
      cellContents.push(cells);
    }

    const colCount = Math.max(...cellContents.map((r) => r.length));
    const colWidths: number[] = [];
    for (let c = 0; c < colCount; c++) {
      colWidths.push(
        Math.max(3, ...cellContents.map((r) => (r[c] || "").length))
      );
    }

    const formatRow = (cells: string[]) =>
      `| ${cells.map((cell, i) => cell.padEnd(colWidths[i])).join(" | ")} |`;

    const separator = `| ${colWidths.map((w) => "-".repeat(w)).join(" | ")} |`;

    state.text(formatRow(cellContents[0]));
    state.ensureNewLine();
    state.text(separator);
    state.ensureNewLine();

    for (let r = 1; r < cellContents.length; r++) {
      state.text(formatRow(cellContents[r]));
      state.ensureNewLine();
    }

    state.closeBlock(node);
  },
  // Row/cell serialization is handled by the table serializer above
  table_row() {
    /* noop */
  },
  table_header() {
    /* noop */
  },
  table_cell() {
    /* noop */
  },
};

const markdownSerializer = new (
  defaultMarkdownSerializer.constructor as new (
    nodes: Record<string, any>,
    marks: Record<string, any>
  ) => typeof defaultMarkdownSerializer
)(
  { ...defaultMarkdownSerializer.nodes, ...tableSerializer },
  defaultMarkdownSerializer.marks
);

export const buildDocumentFromContent = (content: string) => {
  try {
    const parsed = markdownParser.parse(content);
    if (parsed) {
      return parsed;
    }
  } catch {
    // fall through to empty doc
  }
  return documentSchema.topNodeType.createAndFill()!;
};

export const buildContentFromDocument = (document: Node) => {
  return markdownSerializer.serialize(document);
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
