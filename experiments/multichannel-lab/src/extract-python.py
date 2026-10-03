"""Bounded, offline PDF/image extraction. Invoked only by the gated lab worker."""
import csv
import io
import json
import math
import os
import shutil
import subprocess
import sys
import time
import warnings
from pathlib import Path

from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 25_000_000
warnings.simplefilter('error', Image.DecompressionBombWarning)


def main():
    source, surface, output, limits_json = sys.argv[1:]
    cap = json.loads(limits_json)
    deadline = time.monotonic() + cap['timeoutMs'] / 1000 - 1
    source = str(Path(source).resolve())
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    units, previews, notes = [], [], []

    def remaining():
        left = deadline - time.monotonic()
        if left <= 0:
            raise ValueError('Extraction timed out')
        return left

    def command(args):
        remaining()
        result = subprocess.run(args, capture_output=True, timeout=remaining(), check=False)
        if result.returncode:
            raise ValueError(f'{Path(args[0]).name} failed: {result.stderr.decode("utf-8", errors="replace")[:500]}')
        return result.stdout

    def add(unit):
        if len(units) >= cap['units']:
            raise ValueError('Content unit limit exceeded')
        units.append(unit)

    if surface == 'deck':
        import pdfplumber
        from pypdf import PdfReader
        reader = PdfReader(source, strict=True)
        if reader.is_encrypted:
            raise ValueError('Encrypted PDFs are unsupported')
        page_count = len(reader.pages)
        if not page_count or page_count > cap['pages']:
            raise ValueError('PDF page limit exceeded or PDF has no pages')
        renderer = os.environ.get('MOGS_LAB_PDFTOPPM') or shutil.which('pdftoppm')
        if not renderer:
            raise ValueError('PDF rendering unavailable: install Poppler or set MOGS_LAB_PDFTOPPM')
        total_pixels = 0
        with pdfplumber.open(source) as pdf:
            for page_no, page in enumerate(pdf.pages, 1):
                remaining()
                width, height = float(page.width), float(page.height)
                if not math.isfinite(width + height) or min(width, height) <= 0:
                    raise ValueError('Invalid PDF page dimensions')
                anticipated = math.ceil(width * 96 / 72) * math.ceil(height * 96 / 72)
                total_pixels += anticipated
                if total_pixels > cap['pixels']:
                    raise ValueError('PDF total rendered pixel limit exceeded')
                prefix = output / f'page-{page_no}'
                command([renderer, '-f', str(page_no), '-l', str(page_no), '-singlefile', '-r', '96', '-png', str(source), str(prefix)])
                preview_file = prefix.with_suffix('.png')
                with Image.open(preview_file) as image:
                    pixel_w, pixel_h = image.size
                previews.append({'page': page_no, 'file': str(preview_file), 'mime': 'image/png', 'width': pixel_w, 'height': pixel_h})
                words = page.extract_words(x_tolerance=2, y_tolerance=3, keep_blank_chars=False, use_text_flow=False)
                lines = []
                for word in sorted(words, key=lambda w: (round(w['top'] / 3), w['x0'])):
                    matching = next((line for line in reversed(lines[-3:]) if abs(line[0]['top'] - word['top']) <= 3), None)
                    if matching is None:
                        lines.append([word])
                    else:
                        matching.append(word)
                lines.sort(key=lambda line: (min(w['top'] for w in line), min(w['x0'] for w in line)))
                rows = []
                for line in lines:
                    line.sort(key=lambda w: w['x0'])
                    text = ' '.join(w['text'] for w in line).strip()
                    if text:
                        rows.append((text, line))
                full_context = '\n'.join(text for text, _ in rows)
                if not rows:
                    notes.append(f'Page {page_no}: no reliable text layer; scanned or visual content requires separate extraction.')
                if page.images:
                    notes.append(f'Page {page_no}: {len(page.images)} embedded image region(s) are rendered but their visual claims are not extracted.')
                if page.curves:
                    notes.append(f'Page {page_no}: vector artwork may contain visual claims outside text extraction.')
                for line_no, (text, line) in enumerate(rows, 1):
                    x0, top = min(w['x0'] for w in line), min(w['top'] for w in line)
                    x1, bottom = max(w['x1'] for w in line), max(w['bottom'] for w in line)
                    outside_page = x0 < 0 or top < 0 or x1 > width or bottom > height
                    x0, x1 = max(0, min(width, x0)), max(0, min(width, x1))
                    top, bottom = max(0, min(height, top)), max(0, min(height, bottom))
                    bbox = [round(x0 / width * pixel_w, 2), round(top / height * pixel_h, 2), round((x1-x0) / width * pixel_w, 2), round((bottom-top) / height * pixel_h, 2)]
                    if outside_page:
                        notes.append(f'Page {page_no}, line {line_no}: text extends outside the rendered page; correction withheld.')
                    replacement_chars = '\ufffd' in text or '(cid:' in text
                    if replacement_chars:
                        notes.append(f'Page {page_no}, line {line_no}: unreliable font/text encoding.')
                    add({'id': f'pdf-{page_no}-{line_no}', 'text': text, 'role': 'body', 'locator': {'kind': 'pdf', 'page': page_no, 'bbox': bbox}, 'context': full_context, 'confidence': None, 'uncertain': replacement_chars or outside_page})
    else:
        page_count = 1
        with Image.open(source) as original:
            if original.format not in ('PNG', 'JPEG'):
                raise ValueError('Only PNG/JPEG creative is supported')
            if original.width * original.height > cap['pixels']:
                raise ValueError('Creative pixel limit exceeded')
            if getattr(original, 'n_frames', 1) > 1:
                raise ValueError('Animated images are unsupported')
            original.load()
            normalized = ImageOps.exif_transpose(original).convert('RGB')
            pixel_w, pixel_h = normalized.size
            preview_file = output / 'page-1.png'
            normalized.save(preview_file, format='PNG')
        previews.append({'page': 1, 'file': str(preview_file), 'mime': 'image/png', 'width': pixel_w, 'height': pixel_h})
        ocr = os.environ.get('MOGS_LAB_TESSERACT') or shutil.which('tesseract')
        if not ocr and Path('/opt/homebrew/bin/tesseract').exists():
            ocr = '/opt/homebrew/bin/tesseract'
        if not ocr:
            raise ValueError('OCR unavailable: install Tesseract or set MOGS_LAB_TESSERACT')
        tsv = command([ocr, str(preview_file), 'stdout', '--psm', '11', '-l', 'eng', 'tsv']).decode('utf-8')
        groups = {}
        for item in csv.DictReader(io.StringIO(tsv), delimiter='\t', quoting=csv.QUOTE_NONE):
            if item.get('level') != '5' or not (item.get('text') or '').strip():
                continue
            key = (item['block_num'], item['par_num'], item['line_num'])
            groups.setdefault(key, []).append(item)
        rows = []
        for group in groups.values():
            text = ' '.join(item['text'] for item in group)
            x0 = min(int(w['left']) for w in group)
            y0 = min(int(w['top']) for w in group)
            x1 = max(int(w['left']) + int(w['width']) for w in group)
            y1 = max(int(w['top']) + int(w['height']) for w in group)
            confidence = sum(float(w['conf']) for w in group) / len(group)
            uncertain = confidence < 80 or any(float(w['conf']) < 60 for w in group)
            rows.append((y0, x0, text, [x0, y0, x1-x0, y1-y0], confidence, uncertain))
        rows.sort(key=lambda row: (row[0], row[1]))
        full_context = '\n'.join(row[2] for row in rows)
        for n, (_, _, text, bbox, confidence, uncertain) in enumerate(rows, 1):
            add({'id': f'image-1-{n}', 'text': text, 'role': 'body', 'locator': {'kind': 'image', 'page': 1, 'bbox': bbox}, 'context': full_context, 'confidence': round(confidence / 100, 4), 'uncertain': uncertain})
            if uncertain:
                notes.append(f'Image region {n}: OCR confidence is low; correction withheld.')
        if not rows:
            notes.append('No reliable text detected; this is partial coverage, not a clean audit.')
        notes.append('OCR covers detected English text only; non-text visual claims and undetected text remain outside coverage.')
    print(json.dumps({'surface': surface, 'extractor': 'pdfplumber-poppler-v1' if surface == 'deck' else 'tesseract-tsv-v1', 'units': units, 'previews': previews, 'status': 'partial' if notes else 'complete', 'warnings': notes, 'pages': page_count}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
