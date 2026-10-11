from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import date, datetime, timezone
from pathlib import Path

from pypdf import PdfReader

PARSER_VERSION = "pdf-to-md-batch-2.0"
MANIFEST_NAME = "conversion-manifest.json"


def slug_md_name(name: str) -> str:
    cleaned = re.sub(r"[\\/:*?\"<>|]+", " ", name).strip()
    return re.sub(r"\s+", " ", cleaned) + ".md"


def normalize_line(line: str) -> str:
    replacements = {
        "Ã€": "À",
        "Ãˆ": "È",
        "Ã‰": "É",
        "ÃŒ": "Ì",
        "Ã’": "Ò",
        "Ã™": "Ù",
        "Ã ": "à",
        "Ã¨": "è",
        "Ã©": "é",
        "Ã¬": "ì",
        "Ã²": "ò",
        "Ã¹": "ù",
        "â€™": "'",
        "â€œ": '"',
        "â€": '"',
        "â€“": "-",
        "â€”": "-",
        "â€¢": "-",
        "Â°": "°",
        "Â·": "·",
        "Â": "",
    }
    for bad, good in replacements.items():
        line = line.replace(bad, good)
    return re.sub(r"\s+", " ", line).strip()


def extract_pages(pdf_path: Path) -> list[list[str]]:
    reader = PdfReader(str(pdf_path))
    pages: list[list[str]] = []
    for page in reader.pages:
        text = page.extract_text() or ""
        lines = [normalize_line(line) for line in text.splitlines()]
        pages.append([line for line in lines if line])
    return pages


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def quality_report(pages: list[list[str]]) -> dict:
    chars = [sum(len(line) for line in page) for page in pages]
    low_text = [index for index, count in enumerate(chars, 1) if count < 50]
    return {
        "pageCount": len(pages),
        "characterCount": sum(chars),
        "lowTextPages": low_text,
        "requiresReview": bool(low_text),
    }


def detect_repeated_lines(pages: list[list[str]]) -> set[str]:
    if len(pages) < 3:
        return set()
    freq: dict[str, int] = {}
    for lines in pages:
        candidates = lines[:4] + lines[-4:]
        seen = {normalize_line(line).lower() for line in candidates if 4 <= len(line) <= 140}
        for key in seen:
            freq[key] = freq.get(key, 0) + 1
    threshold = max(2, int(len(pages) * 0.45))
    return {key for key, count in freq.items() if count >= threshold}


def is_heading(line: str) -> bool:
    if len(line) > 140:
        return False
    if re.match(r"^(art\.|articolo|capitolo|sezione|quadro|appendice|allegato)\s", line, re.I):
        return True
    if re.match(r"^\d+(\.\d+)*\s+[A-ZÀÈÉÌÒÙ]", line) and len(line) < 100:
        return True
    letters = re.sub(r"[^A-Za-zÀ-ÖØ-öø-ÿ]", "", line)
    return len(letters) > 4 and line == line.upper()


def lines_to_markdown(lines: list[str]) -> list[str]:
    out: list[str] = []
    prev_blank = False
    for line in lines:
        line = normalize_line(line)
        if not line:
            if not prev_blank:
                out.append("")
            prev_blank = True
            continue
        prev_blank = False

        if is_heading(line):
            level = "##" if len(line) < 70 else "###"
            if out and out[-1] != "":
                out.append("")
            out.append(f"{level} {line}")
            out.append("")
            continue

        bullet = re.match(r"^[•·\-\*]\s+(.+)$", line)
        if bullet:
            out.append(f"- {bullet.group(1)}")
            continue

        out.append(line)

    compact: list[str] = []
    blanks = 0
    for line in out:
        if line == "":
            blanks += 1
            if blanks <= 1:
                compact.append(line)
        else:
            blanks = 0
            compact.append(line)
    return compact


def insert_chunks(text: str, chunk_size: int) -> str:
    frontmatter = ""
    body = text
    match = re.match(r"^(---\n[\s\S]*?\n---\n\n# .+?\n\n)", text)
    if match:
        frontmatter = match.group(1)
        body = text[len(frontmatter):]

    paragraphs = re.split(r"\n{2,}", body)
    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        paragraph = paragraph.strip()
        if not paragraph:
            continue
        if current and len(current) + len(paragraph) > chunk_size:
            chunks.append(current)
            current = paragraph
        else:
            current = f"{current}\n\n{paragraph}".strip() if current else paragraph
    if current:
        chunks.append(current)

    marked = []
    for index, chunk in enumerate(chunks, start=1):
        marked.append(f"<!-- CHUNK_{index}_START -->\n{chunk}\n<!-- CHUNK_{index}_END -->")
    return frontmatter + "\n\n".join(marked).strip() + "\n"


def convert_pdf(pdf_path: Path, output_dir: Path, chunk_size: int) -> Path:
    pages = extract_pages(pdf_path)
    repeated = detect_repeated_lines(pages)

    body_lines: list[str] = []
    for page_number, lines in enumerate(pages, start=1):
        filtered = [line for line in lines if normalize_line(line).lower() not in repeated]
        if filtered:
            body_lines.append(f"<!-- pagina {page_number} -->")
            body_lines.extend(filtered)
            body_lines.append("")

    source_hash = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
    title = pdf_path.stem
    md_lines = [
        "---",
        f'titolo: "{title}"',
        f'fonte: "{pdf_path.name}"',
        f"data_conversione: {date.today().isoformat()}",
        f"pagine: {len(pages)}",
        f"sha256_originale: {source_hash}",
        "formato_originale: pdf",
        "modello_rag: true",
        "---",
        "",
        f"# {title}",
        "",
    ]
    md_lines.extend(lines_to_markdown(body_lines))
    markdown = insert_chunks("\n".join(md_lines), chunk_size)

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / slug_md_name(pdf_path.stem)
    output_path.write_text(markdown, encoding="utf-8")
    return output_path


def is_jan_macro_heading(line: str) -> bool:
    if len(line) > 130:
        return False
    patterns = [
        r"^quadro\s+[A-Z0-9]+(\s|$)",
        r"^appendice(\s|$)",
        r"^allegato(\s|$)",
        r"^capitolo\s+",
        r"^sezione\s+",
        r"^istruzioni\s+",
        r"^le principali novit",
        r"^frontespizio(\s|$)",
    ]
    return any(re.match(pattern, line, re.I) for pattern in patterns)


def lines_to_jan_markdown(lines: list[str]) -> list[str]:
    out: list[str] = []
    prev_blank = False
    for raw in lines:
        line = normalize_line(raw)
        if not line:
            if not prev_blank:
                out.append("")
            prev_blank = True
            continue
        prev_blank = False

        if is_jan_macro_heading(line):
            if out and out[-1] != "":
                out.append("")
            out.append(f"## {line}")
            out.append("")
            continue

        bullet = re.match(r"^[•·\-\*]\s+(.+)$", line)
        if bullet:
            out.append(f"- {bullet.group(1)}")
        else:
            out.append(line)

    compact: list[str] = []
    blanks = 0
    for line in out:
        if line == "":
            blanks += 1
            if blanks <= 1:
                compact.append(line)
        else:
            blanks = 0
            compact.append(line)
    return compact


def jan_frontmatter(title: str, source_name: str, page_from: int, page_to: int) -> list[str]:
    return [
        "---",
        f'titolo: "{title}"',
        f'fonte: "{source_name}"',
        f"pagine: {page_from}-{page_to}",
        f"data_conversione: {date.today().isoformat()}",
        "---",
        "",
        f"# {title}",
        "",
    ]


def convert_pdf_for_jan(
    pdf_path: Path,
    output_dir: Path,
    pages_per_file: int = 12,
    max_chars: int = 120_000,
) -> list[Path]:
    pages = extract_pages(pdf_path)
    repeated = detect_repeated_lines(pages)
    output_dir.mkdir(parents=True, exist_ok=True)

    for old in output_dir.glob(f"{pdf_path.stem}__p*.md"):
        old.unlink()

    outputs: list[Path] = []
    current_pages: list[tuple[int, list[str]]] = []
    current_chars = 0

    def flush() -> None:
        nonlocal current_pages, current_chars
        if not current_pages:
            return
        page_from = current_pages[0][0]
        page_to = current_pages[-1][0]
        title = f"{pdf_path.stem} - pagine {page_from}-{page_to}"
        lines = jan_frontmatter(title, pdf_path.name, page_from, page_to)
        for page_number, page_lines in current_pages:
            cleaned = [line for line in page_lines if normalize_line(line).lower() not in repeated]
            if not cleaned:
                continue
            lines.append("")
            lines.append(f"Pagina {page_number}")
            lines.append("")
            lines.extend(lines_to_jan_markdown(cleaned))
        md = "\n".join(lines).strip() + "\n"
        out_name = f"{pdf_path.stem}__p{page_from:03d}-{page_to:03d}.md"
        out_path = output_dir / slug_md_name(out_name[:-3])
        out_path.write_text(md, encoding="utf-8")
        outputs.append(out_path)
        current_pages = []
        current_chars = 0

    for page_number, page_lines in enumerate(pages, start=1):
        page_chars = sum(len(line) for line in page_lines)
        should_flush = current_pages and (
            len(current_pages) >= pages_per_file or current_chars + page_chars > max_chars
        )
        if should_flush:
            flush()
        current_pages.append((page_number, page_lines))
        current_chars += page_chars
    flush()
    return outputs


def is_probable_toc_line(line: str) -> bool:
    compact = normalize_line(line)
    if not compact:
        return True
    if re.fullmatch(r"\d{1,4}", compact):
        return True
    if re.fullmatch(r"[IVXLCDM]{1,8}", compact, re.I):
        return True
    if len(compact) < 4:
        return True
    if len(compact) < 120 and re.match(r"^(\d+[\.\)]\s+)?[A-Za-zÀ-ÖØ-öø-ÿ].*\s\d{1,4}$", compact):
        return True
    if re.match(r"^(indice|sommario)\b", compact, re.I):
        return True
    return False


def jan_lite_clean_lines(lines: list[str], repeated: set[str]) -> list[str]:
    cleaned: list[str] = []
    for line in lines:
        line = normalize_line(line)
        key = line.lower()
        if key in repeated:
            continue
        if is_probable_toc_line(line):
            continue
        line = re.sub(r"^[-–—•·]\s*", "", line).strip()
        if not line:
            continue
        cleaned.append(line)
    return cleaned


def convert_pdf_for_jan_lite(
    pdf_path: Path,
    output_dir: Path,
    max_chars: int = 18_000,
) -> list[Path]:
    pages = extract_pages(pdf_path)
    repeated = detect_repeated_lines(pages)
    output_dir.mkdir(parents=True, exist_ok=True)

    for old in output_dir.glob(f"{pdf_path.stem}__lite*.md"):
        old.unlink()

    outputs: list[Path] = []
    current: list[str] = []
    current_start_page = 1
    current_end_page = 1
    current_chars = 0

    def flush() -> None:
        nonlocal current, current_start_page, current_end_page, current_chars
        if not current:
            return
        title = f"{pdf_path.stem} pagine {current_start_page}-{current_end_page}"
        lines = [
            f"# {title}",
            "",
            f"Fonte: {pdf_path.name}",
            f"Pagine: {current_start_page}-{current_end_page}",
            "",
            *current,
            "",
        ]
        out_name = f"{pdf_path.stem}__lite_p{current_start_page:03d}-{current_end_page:03d}.md"
        out_path = output_dir / slug_md_name(out_name[:-3])
        out_path.write_text("\n".join(lines), encoding="utf-8")
        outputs.append(out_path)
        current = []
        current_chars = 0

    for page_number, page_lines in enumerate(pages, start=1):
        cleaned = jan_lite_clean_lines(page_lines, repeated)
        if not cleaned:
            continue
        page_block = [f"Pagina {page_number}", *cleaned, ""]
        page_chars = sum(len(line) for line in page_block)
        if current and current_chars + page_chars > max_chars:
            flush()
            current_start_page = page_number
        current.extend(page_block)
        current_end_page = page_number
        current_chars += page_chars
    flush()
    return outputs


def main() -> None:
    parser = argparse.ArgumentParser(description="Converte PDF di un notebook Nextcloud in Markdown RAG.")
    parser.add_argument("source_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--chunk-size", type=int, default=900)
    parser.add_argument("--jan-ready", action="store_true")
    parser.add_argument("--jan-lite", action="store_true")
    parser.add_argument("--pages-per-file", type=int, default=12)
    parser.add_argument("--max-chars", type=int, default=120000)
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = args.output_dir / MANIFEST_NAME
    try:
        previous = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    except Exception:
        previous = {}
    previous_files = previous.get("files", {})
    current_names = {pdf.name for pdf in args.source_dir.glob("*.pdf")}
    for removed_name in set(previous_files) - current_names:
        for output in previous_files[removed_name].get("outputs", []):
            candidate = args.output_dir / output.get("name", "")
            if candidate.is_file() and candidate.parent == args.output_dir:
                candidate.unlink()

    pdfs = sorted(args.source_dir.glob("*.pdf"))
    if not pdfs:
        print("Nessun PDF trovato.")
        return

    mode = "jan-lite" if args.jan_lite else "jan-ready" if args.jan_ready else "standard"
    options = {"mode": mode, "chunkSize": args.chunk_size, "pagesPerFile": args.pages_per_file, "maxChars": args.max_chars}
    option_hash = hashlib.sha256(json.dumps(options, sort_keys=True).encode()).hexdigest()
    manifest_files = {}
    converted = skipped = 0
    for pdf in pdfs:
        source_hash = file_sha256(pdf)
        old = previous_files.get(pdf.name, {})
        if old.get("sourceSha256") == source_hash and old.get("optionsSha256") == option_hash and all((args.output_dir / item.get("name", "")).is_file() for item in old.get("outputs", [])):
            manifest_files[pdf.name] = old
            skipped += 1
            print(f"SKIP {pdf.name} invariato")
            continue
        if args.jan_lite:
            outputs = convert_pdf_for_jan_lite(pdf, args.output_dir, args.max_chars)
            print(f"OK {pdf.name} -> {len(outputs)} file Jan-lite")
        elif args.jan_ready:
            outputs = convert_pdf_for_jan(pdf, args.output_dir, args.pages_per_file, args.max_chars)
            print(f"OK {pdf.name} -> {len(outputs)} file Jan-ready")
        else:
            output = convert_pdf(pdf, args.output_dir, args.chunk_size)
            outputs = [output]
            print(f"OK {pdf.name} -> {output.name}")
        pages = extract_pages(pdf)
        manifest_files[pdf.name] = {
            "sourceSha256": source_hash,
            "optionsSha256": option_hash,
            "parserVersion": PARSER_VERSION,
            "convertedAt": datetime.now(timezone.utc).isoformat(),
            "quality": quality_report(pages),
            "outputs": [{"name": item.name, "sha256": file_sha256(item)} for item in outputs],
        }
        converted += 1

    manifest = {
        "schemaVersion": 1,
        "parserVersion": PARSER_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "options": options,
        "summary": {"converted": converted, "skipped": skipped, "removed": len(set(previous_files) - current_names)},
        "files": manifest_files,
    }
    temp_manifest = manifest_path.with_suffix(".tmp")
    temp_manifest.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    temp_manifest.replace(manifest_path)


if __name__ == "__main__":
    main()
