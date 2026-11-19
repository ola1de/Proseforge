// Test fixtures (TEST-ONLY): programmatically built sample documents.
// These are real, valid files constructed from OOXML/ODT/PDF parts —
// not hand-waved strings — so the M2 round-trip tests prove the engine
// preserves structure instead of merely asserting on its own output.
import JSZip from "jszip";
import { deflateSync } from "node:zlib";

const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

export const SAMPLE_BODY_1 =
  "Digital governance has changed how citizens interact with public institutions in profound ways. This study examines the effect of electronic service delivery on citizen satisfaction in three Nigerian states.";
export const SAMPLE_BODY_2 =
  "The findings show that response times improved by a wide margin after the new portal was introduced. Citizens reported that they spent less time travelling to government offices.";
export const SAMPLE_BODY_SPLIT =
  "This paragraph is deliberately split across several runs to prove the engine joins runs before refining.";
export const SAMPLE_ABSTRACT =
  "This study investigates the impact of digital governance on public service delivery in Nigeria, using survey data from three states and a mixed-methods design.";
export const SAMPLE_LIT =
  "Previous studies have examined electronic government from the perspective of technology adoption. Far less attention has been paid to how citizens themselves experience these services in everyday life.";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const run = (text: string) => `<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const para = (style: string, inner: string) =>
  `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${inner}</w:p>`;
const heading = (level: number, text: string) => para(`Heading${level}`, run(text));
const body = (text: string) => para("Normal", run(text));

export async function buildSampleDocx(): Promise<Uint8Array> {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
<w:body>
${para("Title", run("The Impact of Digital Governance on Public Service Delivery"))}
${heading(1, "Abstract")}
${body(SAMPLE_ABSTRACT)}
${heading(1, "Chapter One: Introduction")}
${body(SAMPLE_BODY_1)}
<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${run("The findings show that response times improved")}<w:r><w:footnoteReference w:id="1"/></w:r>${run(" by a wide margin after the new portal was introduced. Citizens reported that they spent less time travelling to government offices.")}</w:p>
<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${run("As noted by earlier work, adoption depends on trust")}<w:r><w:rPr><w:rStyle w:val="Citation"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> CITATION Ade2021 \\l 1033 </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t xml:space="preserve">(Adeyemi, 2021)</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>${run(", and this study builds on that insight.")}</w:p>
<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:hyperlink r:id="rId7"><w:r><w:t xml:space="preserve">National Bureau of Statistics portal</w:t></w:r></w:hyperlink>${run(" publishes the underlying service data used in this chapter.")}</w:p>
${heading(2, "Background of the Study")}
<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t xml:space="preserve">This paragraph is deliberately split</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve"> across several runs to prove</w:t></w:r><w:r><w:t xml:space="preserve"> the engine joins runs before refining.</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run("First item in a numbered list that should be refined as body text.")}</w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run("Second item in the same numbered list.")}</w:p>
<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>
<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p>${run("Merged header cell — table text must never be refined.")}</w:p></w:tc></w:tr>
<w:tr><w:tc><w:p>${run("Lagos")}</w:p></w:tc><w:tc><w:p>${run("78 percent satisfaction")}</w:p></w:tc></w:tr>
</w:tbl>
${para("Caption", run("Table 1: Citizen satisfaction by state."))}
${heading(1, "Chapter Two: Literature Review")}
${body(SAMPLE_LIT)}
<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${run("The model is expressed as ")}<w:r><m:oMath><m:r><m:t>y = a + bx</m:t></m:r></m:oMath></w:r>${run(" and must not be rewritten.")}</w:p>
<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:br w:type="page"/></w:r>${run("Text after a page break.")}</w:p>
${heading(1, "References")}
${para("Bibliography", run("Adeyemi, T. (2021). Electronic government and citizen trust. Journal of Public Administration, 12(3), 45–61."))}
${para("Bibliography", run("Okonkwo, E. (2020). Digital service delivery in West Africa. Ibadan: University Press."))}
${heading(1, "Appendix A: Questionnaire")}
${body("1. How often do you use the government service portal? (a) Daily (b) Weekly (c) Monthly (d) Never")}
<w:p><w:pPr><w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/><w:headerReference w:type="default" r:id="rId4"/><w:footerReference w:type="default" r:id="rId5"/></w:sectPr></w:pPr></w:p>
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/><w:headerReference w:type="default" r:id="rId4"/><w:footerReference w:type="default" r:id="rId5"/></w:sectPr>
</w:body></w:document>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="480" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="0F172A"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:i/><w:sz w:val="18"/><w:color w:val="64748B"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Bibliography"><w:name w:val="Bibliography"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style>
</w:styles>`;

  const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

  const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Proseforge sample dissertation — header text must survive.</w:t></w:r></w:p></w:hdr>`;
  const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Page </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
  const footnotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:footnote w:type="separator" w:id="0"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
<w:footnote w:id="1"><w:p><w:r><w:t>Footnote text that must never be refined or moved.</w:t></w:r></w:p></w:footnote>
</w:footnotes>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
<Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://www.nigerianstat.gov.ng" TargetMode="External"/>
</Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("_rels/.rels", rels);
  zip.file("word/document.xml", documentXml);
  zip.file("word/styles.xml", stylesXml);
  zip.file("word/numbering.xml", numberingXml);
  zip.file("word/header1.xml", headerXml);
  zip.file("word/footer1.xml", footerXml);
  zip.file("word/footnotes.xml", footnotesXml);
  zip.file("word/_rels/document.xml.rels", docRels);
  zip.file("word/media/image1.png", PNG_1X1);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export async function buildSampleOdt(): Promise<Uint8Array> {
  const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" office:version="1.2">
<office:automatic-styles>
<style:style style:name="P1" style:family="paragraph" style:parent-style-name="Standard"><style:text-properties style:font-name="Calibri"/></style:style>
<style:style style:name="P2" style:family="paragraph" style:parent-style-name="Heading_20_1"><style:text-properties style:font-weight="bold"/></style:style>
</office:automatic-styles>
<office:body><office:text>
<text:p text:style-name="Title">ODT Sample Dissertation</text:p>
<text:h text:style-name="Heading_20_1" text:outline-level="1">Chapter One: Introduction</text:h>
<text:p text:style-name="Standard">${esc(SAMPLE_BODY_1)}</text:p>
<text:p text:style-name="Standard">A second body paragraph with a <text:span text:style-name="T1">bold span</text:span> inside it, to prove span formatting survives.</text:p>
<table:table table:name="Table1"><table:table-row><table:table-cell><text:p>Cell text that must never be refined.</text:p></table:table-cell></table:table-row></table:table>
<text:h text:style-name="Heading_20_1" text:outline-level="1">References</text:h>
<text:p text:style-name="Standard">Adeyemi, T. (2021). Electronic government and citizen trust.</text:p>
</office:text></office:body>
</office:document-content>`;
  const zip = new JSZip();
  zip.file("mimetype", "application/vnd.oasis.opendocument.text");
  zip.file("content.xml", contentXml);
  zip.file("META-INF/manifest.xml", `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:media-type="application/vnd.oasis.opendocument.text" manifest:full-path="/"/><manifest:file-entry manifest:media-type="text/xml" manifest:full-path="content.xml"/></manifest:manifest>`);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export const SAMPLE_RTF =
  "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\fnil Calibri;}}\\viewkind4\\uc1\\pard\\f0\\fs22 " +
  "This is a \\b bold \\b0 and \\i italic \\i0 plain paragraph for testing.\\par\n" +
  "A second paragraph with \\b strong wording \\b0 to refine.\\par\n}";

/** Minimal text-layer PDF: one page, one FlateDecode content stream. */
export function buildSamplePdf(): Uint8Array {
  const content = "BT /F1 12 Tf 72 720 Td (Digital governance has changed how citizens interact with public institutions.) Tj ET\n" +
    "BT /F1 12 Tf 72 700 Td (The findings show that response times improved by a wide margin.) Tj ET\n";
  const compressed = deflateSync(Buffer.from(content, "latin1"));
  const stream = Buffer.concat([Buffer.from("stream\n", "latin1"), compressed, Buffer.from("\nendstream", "latin1")]);
  const parts: Buffer[] = [];
  parts.push(Buffer.from("%PDF-1.4\n", "latin1"));
  parts.push(Buffer.from("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n", "latin1"));
  parts.push(Buffer.from("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n", "latin1"));
  parts.push(Buffer.from("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n", "latin1"));
  parts.push(Buffer.from(`4 0 obj\n<< /Length ${stream.length} /Filter /FlateDecode >>\n`, "latin1"));
  parts.push(stream);
  parts.push(Buffer.from("\nendobj\n", "latin1"));
  parts.push(Buffer.from("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n", "latin1"));
  parts.push(Buffer.from("trailer\n<< /Root 1 0 R /Size 6 >>\n%%EOF\n", "latin1"));
  return new Uint8Array(Buffer.concat(parts));
}

/** A scanned (image-only) PDF: valid header, no text operators at all. */
export function buildScannedPdf(): Uint8Array {
  return new TextEncoder().encode(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n" +
    "trailer\n<< /Root 1 0 R /Size 4 >>\n%%EOF\n",
  );
}
