import { defineRule, eslintCompatPlugin } from "@oxlint/plugins";

const MAX_LINES = 3;
const EXEMPT_BLOCK = /^\s*(SAFETY:|@license)/u;
const DIRECTIVE =
  /^\s*(oxlint-|eslint-|@ts-|biome-ignore|fallow-ignore|react-doctor-|prettier-ignore|oxfmt-ignore)/u;
const bodyOf = (comment: Comment) => comment.value.replace(/^\*+/u, "");

type Comment = { type: string; value: string; start: number; end: number };

const textLines = (comment: Comment) =>
  comment.value.split("\n").filter((line) => line.replace(/^\s*\*+/u, "").trim() !== "").length;

const maxCommentLinesRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: `Comments stay at ${MAX_LINES} lines or fewer.` },
    messages: {
      tooLong: `This comment runs {{lines}} lines. Keep only what the code cannot say, in ${MAX_LINES} lines or fewer.`,
    },
    schema: [],
  },
  create(context) {
    return {
      Program() {
        const text = context.sourceCode.text;
        const newlines: number[] = [];
        for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) newlines.push(i);
        const lineOf = (offset: number) => {
          let low = 0;
          let high = newlines.length;
          while (low < high) {
            const mid = (low + high) >> 1;
            if ((newlines[mid] ?? Infinity) < offset) low = mid + 1;
            else high = mid;
          }
          return low + 1;
        };
        const blocks: { first: Comment; startLine: number; endLine: number; lines: number }[] = [];
        for (const comment of context.sourceCode.getAllComments()) {
          if (DIRECTIVE.test(bodyOf(comment))) {
            blocks.push({ first: comment, startLine: -2, endLine: -2, lines: 0 });
            continue;
          }
          const startLine = lineOf(comment.start);
          const endLine = lineOf(comment.end);
          const last = blocks.at(-1);
          if (
            comment.type === "Line" &&
            last?.first.type === "Line" &&
            last.endLine === startLine - 1
          ) {
            last.endLine = endLine;
            last.lines += textLines(comment);
          } else blocks.push({ first: comment, startLine, endLine, lines: textLines(comment) });
        }
        for (const block of blocks) {
          const { lines } = block;
          if (lines <= MAX_LINES || EXEMPT_BLOCK.test(bodyOf(block.first))) continue;
          context.report({
            loc: {
              start: { line: block.startLine, column: 0 },
              end: { line: block.endLine, column: 0 },
            },
            messageId: "tooLong",
            data: { lines: String(lines) },
          });
        }
      },
    };
  },
});

export default eslintCompatPlugin({
  meta: { name: "rdyrct" },
  rules: { "max-comment-lines": maxCommentLinesRule },
});
