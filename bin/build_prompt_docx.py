"""Regenerate export-only prompt DOCX files from their canonical TXT sources."""

from __future__ import annotations

from html import escape
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
PROMPTS = (
    (
        ROOT / "hospitality" / "prompt Hospitality .txt",
        ROOT / "hospitality" / "prompt Hospitality .docx",
    ),
    (
        ROOT / "hypertension" / "Prompt Hypetension.txt",
        ROOT / "hypertension" / "Prompt Hypetension.docx",
    ),
)


CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""


def document_xml(text: str) -> str:
    paragraphs = []
    for line in text.replace("\ufeff", "").splitlines():
        if line:
            paragraphs.append(
                '<w:p><w:r><w:t xml:space="preserve">'
                f"{escape(line)}"
                "</w:t></w:r></w:p>"
            )
        else:
            paragraphs.append("<w:p/>")
    body = "".join(paragraphs)
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}<w:sectPr/></w:body></w:document>"
    )


def build(source: Path, destination: Path) -> None:
    text = source.read_text(encoding="utf-8-sig")
    with ZipFile(destination, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", CONTENT_TYPES)
        archive.writestr("_rels/.rels", ROOT_RELS)
        archive.writestr("word/document.xml", document_xml(text))


def main() -> int:
    for source, destination in PROMPTS:
        build(source, destination)
        print(f"built {destination.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
