import { textblockTypeInputRule } from "prosemirror-inputrules";
import { Schema } from "prosemirror-model";
import { schema } from "prosemirror-schema-basic";
import { addListNodes } from "prosemirror-schema-list";
import type { Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { MutableRefObject } from "react";

import { buildContentFromDocument } from "./functions";

const baseNodes = addListNodes(schema.spec.nodes, "paragraph block*", "block");

export const documentSchema = new Schema({
  nodes: baseNodes
    .addToEnd("table", {
      content: "table_row+",
      tableRole: "table",
      group: "block",
      parseDOM: [{ tag: "table" }],
      toDOM() {
        return ["table", { class: "prose-table" }, ["tbody", 0]];
      },
    })
    .addToEnd("table_row", {
      content: "(table_cell | table_header)+",
      tableRole: "row",
      parseDOM: [{ tag: "tr" }],
      toDOM() {
        return ["tr", 0];
      },
    })
    .addToEnd("table_header", {
      content: "inline*",
      tableRole: "header_cell",
      parseDOM: [{ tag: "th" }],
      toDOM() {
        return ["th", 0];
      },
    })
    .addToEnd("table_cell", {
      content: "inline*",
      tableRole: "cell",
      parseDOM: [{ tag: "td" }],
      toDOM() {
        return ["td", 0];
      },
    }),
  marks: schema.spec.marks,
});

export function headingRule(level: number) {
  return textblockTypeInputRule(
    new RegExp(`^(#{1,${level}})\\s$`),
    documentSchema.nodes.heading,
    () => ({ level })
  );
}

export const handleTransaction = ({
  transaction,
  editorRef,
  onSaveContent,
}: {
  transaction: Transaction;
  editorRef: MutableRefObject<EditorView | null>;
  onSaveContent: (updatedContent: string, debounce: boolean) => void;
}) => {
  if (!editorRef || !editorRef.current) {
    return;
  }

  const newState = editorRef.current.state.apply(transaction);
  editorRef.current.updateState(newState);

  if (transaction.docChanged && !transaction.getMeta("no-save")) {
    const updatedContent = buildContentFromDocument(newState.doc);

    if (transaction.getMeta("no-debounce")) {
      onSaveContent(updatedContent, false);
    } else {
      onSaveContent(updatedContent, true);
    }
  }
};
