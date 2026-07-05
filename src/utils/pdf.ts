import { createWriteStream } from "node:fs";
import { lexer, type Token, type Tokens } from "marked";
import PDFDocument from "pdfkit";

const MARGIN = 56;
const BODY_SIZE = 11;
const BODY_COLOR = "#111827";
const MUTED_COLOR = "#6b7280";

export function writeMarkdownPdf(markdown: string, filePath: string) {
  return new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      bufferPages: true,
      margins: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
      info: { Title: "PRD Document", Creator: "assignment-dua" },
    });

    const stream = createWriteStream(filePath);
    stream.on("finish", resolve);
    stream.on("error", reject);
    doc.on("error", reject);

    doc.pipe(stream);
    renderTokens(doc, lexer(markdown));
    addPageNumbers(doc);
    doc.end();
  });
}

function renderTokens(doc: PDFKit.PDFDocument, tokens: Token[], indent = 0) {
  for (const token of tokens) {
    if (token.type === "space") {
      doc.moveDown(0.4);
    } else if (token.type === "heading") {
      renderHeading(doc, token as Tokens.Heading, indent);
    } else if (token.type === "paragraph" || token.type === "text") {
      renderText(doc, inlineText(token.tokens, token.text), indent);
    } else if (token.type === "list") {
      renderList(doc, token as Tokens.List, indent);
    } else if (token.type === "code") {
      renderCode(doc, (token as Tokens.Code).text, indent);
    } else if (token.type === "table") {
      renderTable(doc, token as Tokens.Table, indent);
    } else if ("tokens" in token && Array.isArray(token.tokens)) {
      renderTokens(doc, token.tokens, indent);
    }
  }
}

function renderHeading(doc: PDFKit.PDFDocument, token: Tokens.Heading, indent: number) {
  const fontSize = token.depth === 1 ? 22 : token.depth === 2 ? 17 : 14;
  ensureSpace(doc, fontSize * 2);
  doc
    .moveDown(token.depth === 1 ? 0.7 : 0.45)
    .font("Helvetica-Bold")
    .fontSize(fontSize)
    .fillColor(BODY_COLOR)
    .text(inlineText(token.tokens, token.text), x(doc, indent), doc.y, {
      width: width(doc, indent),
      lineGap: 2,
    });
  doc.moveDown(0.35);
}

function renderText(doc: PDFKit.PDFDocument, text: string, indent: number) {
  const value = text.trim();
  if (!value) return;
  ensureSpace(doc, BODY_SIZE * 2);
  doc
    .font("Helvetica")
    .fontSize(BODY_SIZE)
    .fillColor(BODY_COLOR)
    .text(value, x(doc, indent), doc.y, { width: width(doc, indent), lineGap: 4 });
  doc.moveDown(0.65);
}

function renderList(doc: PDFKit.PDFDocument, token: Tokens.List, indent: number) {
  const start = typeof token.start === "number" ? token.start : 1;

  token.items.forEach((item, index) => {
    const label = token.ordered ? `${start + index}.` : "-";
    const labelWidth = 24;
    const first = item.tokens[0];
    const firstText =
      first?.type === "paragraph" || first?.type === "text"
        ? inlineText(first.tokens, first.text)
        : item.text.split("\n")[0] || "";
    const rest =
      first?.type === "paragraph" || first?.type === "text"
        ? item.tokens.slice(1)
        : item.tokens;

    doc.font("Helvetica").fontSize(BODY_SIZE).fillColor(BODY_COLOR);
    const itemHeight = doc.heightOfString(firstText.trim() || " ", {
      width: width(doc, indent + labelWidth),
      lineGap: 4,
    });

    ensureSpace(doc, Math.max(BODY_SIZE * 2, itemHeight));

    const y = doc.y;
    doc.text(label, x(doc, indent), y, { width: labelWidth });
    doc.text(firstText.trim(), x(doc, indent + labelWidth), y, {
      width: width(doc, indent + labelWidth),
      lineGap: 4,
    });
    doc.moveDown(0.35);

    if (rest.length > 0) {
      renderTokens(doc, rest, indent + labelWidth);
    }
  });

  doc.moveDown(0.35);
}

function renderCode(doc: PDFKit.PDFDocument, text: string, indent: number) {
  const value = text.trimEnd();
  const blockWidth = width(doc, indent);

  doc.font("Courier").fontSize(9);
  const height = doc.heightOfString(value, { width: blockWidth, lineGap: 3 }) + 18;

  if (height > usableHeight(doc)) {
    renderLargeCode(doc, value, indent);
    return;
  }

  ensureSpace(doc, height);

  const blockX = x(doc, indent);
  const blockY = doc.y;
  doc.save().roundedRect(blockX, blockY, blockWidth, height, 4).fillAndStroke("#f3f4f6", "#e5e7eb").restore();
  doc.font("Courier").fontSize(9).fillColor(BODY_COLOR).text(value, blockX + 9, blockY + 9, {
    width: blockWidth - 18,
    lineGap: 3,
  });
  doc.y = blockY + height + 8;
}

function renderLargeCode(doc: PDFKit.PDFDocument, text: string, indent: number) {
  for (const line of text.split("\n")) {
    const lineHeight = doc.heightOfString(line || " ", {
      width: width(doc, indent),
      lineGap: 3,
    });

    ensureSpace(doc, lineHeight + 6);
    doc.font("Courier").fontSize(9).fillColor(BODY_COLOR).text(line || " ", x(doc, indent), doc.y, {
      width: width(doc, indent),
      lineGap: 3,
    });
  }

  doc.moveDown(0.5);
}

function renderTable(doc: PDFKit.PDFDocument, token: Tokens.Table, indent: number) {
  const rows = [token.header, ...token.rows]
    .map((row) => row.map((cell) => inlineText(cell.tokens, cell.text)).join(" | "))
    .join("\n");

  renderCode(doc, rows, indent);
}

function addPageNumbers(doc: PDFKit.PDFDocument) {
  const range = doc.bufferedPageRange();

  for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
    doc.switchToPage(pageIndex);
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(MUTED_COLOR)
      .text(`Page ${pageIndex - range.start + 1} of ${range.count}`, doc.page.margins.left, doc.page.height - doc.page.margins.bottom - 18, {
        align: "center",
        width: contentWidth(doc),
      });
  }
}

function inlineText(tokens: Token[] | undefined, fallback: string) {
  if (!tokens || tokens.length === 0) return fallback;
  return tokens.map(inlineTokenText).join("");
}

function inlineTokenText(token: Token): string {
  if (token.type === "br") return "\n";
  if (token.type === "codespan") return token.text;
  if (token.type === "link") {
    const text = inlineText(token.tokens, token.text);
    return text === token.href ? text : `${text} (${token.href})`;
  }
  if (token.type === "image") return token.text ? `[image: ${token.text}]` : "[image]";
  if (token.type === "html") return stripHtml(token.text);
  if ("tokens" in token && Array.isArray(token.tokens)) return inlineText(token.tokens, token.raw);
  return "text" in token && typeof token.text === "string" ? token.text : token.raw;
}

function stripHtml(value: string) {
  return value.replaceAll(/<[^>]*>/g, "").trim();
}

function ensureSpace(doc: PDFKit.PDFDocument, height: number) {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function usableHeight(doc: PDFKit.PDFDocument) {
  return doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
}

function x(doc: PDFKit.PDFDocument, indent: number) {
  return doc.page.margins.left + indent;
}

function width(doc: PDFKit.PDFDocument, indent: number) {
  return contentWidth(doc) - indent;
}

function contentWidth(doc: PDFKit.PDFDocument) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}
