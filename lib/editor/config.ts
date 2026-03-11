import { textblockTypeInputRule } from "prosemirror-inputrules";
import { Schema } from "prosemirror-model";
import { schema } from "prosemirror-schema-basic";
import { addListNodes } from "prosemirror-schema-list";

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
