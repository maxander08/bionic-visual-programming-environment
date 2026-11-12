#!/usr/bin/env python3
"""
Builds the two bundled Chinese typefaces for Neural Studio:

    src/assets/fonts/NotoSansSC-subset.woff2   (Simplified Chinese)
    src/assets/fonts/NotoSansTC-subset.woff2   (Traditional Chinese)

These are the ONLY fonts the interface is allowed to use for Chinese text. They are variable-weight
(400-700) subsets of the official Noto Sans SC / Noto Sans TC (SIL OFL 1.1) that contain:

  * every CJK character found anywhere in src/ (all translations, labels, docs),
  * SC: the full GB2312 set (6,763 hanzi) · TC: Big5 level 1 + 2 common hanzi (5,401 + punctuation),
  * CJK punctuation and full-width forms.

Usage:
    pip install fonttools brotli
    python3 scripts/fonts/build-noto-subsets.py [path/to/NotoSansSC[wght].ttf path/to/NotoSansTC[wght].ttf]

Without arguments the variable TTFs are downloaded from github.com/google/fonts.
"""
import glob
import io
import os
import sys
import urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "src", "assets", "fonts")
URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/notosans{lc}/NotoSans{n}%5Bwght%5D.ttf"


def is_cjk(o: int) -> bool:
    return (0x2E80 <= o <= 0x9FFF) or (0xF900 <= o <= 0xFAFF) or (0xFE30 <= o <= 0xFE4F) or (0xFF00 <= o <= 0xFFEF)


def chars_in_source() -> set:
    out = set()
    for f in glob.glob(os.path.join(ROOT, "src", "**", "*"), recursive=True):
        if f.endswith((".ts", ".tsx", ".css", ".html")):
            with open(f, encoding="utf8") as fh:
                out.update(c for c in fh.read() if is_cjk(ord(c)))
    return out


def codec_hanzi(codec: str, first: range) -> set:
    out = set()
    for b1 in first:
        seconds = range(0xA1, 0xFF) if codec == "gb2312" else list(range(0x40, 0x7F)) + list(range(0xA1, 0xFF))
        for b2 in seconds:
            try:
                out.add(bytes([b1, b2]).decode(codec))
            except UnicodeDecodeError:
                pass
    return out


PUNCT = "".join(chr(c) for c in list(range(0x3000, 0x3040)) + list(range(0xFF01, 0xFF5F)) + [0xFFE0, 0xFFE1, 0xFFE5])


def build(ttf_path: str, charset: set, out_path: str) -> None:
    font = TTFont(ttf_path)
    opts = subset.Options()
    opts.layout_features = ["kern", "vert", "vrt2", "locl", "ccmp", "halt", "vkrn", "vpal", "palt"]
    opts.name_IDs = [0, 1, 2, 3, 4, 6, 13, 14]  # keep the licence strings
    opts.notdef_outline = True
    opts.hinting = False
    opts.desubroutinize = True
    s = subset.Subsetter(opts)
    s.populate(text="".join(charset) + PUNCT)
    s.subset(font)
    buf = io.BytesIO()
    font.save(buf)
    buf.seek(0)
    font = TTFont(buf)
    font = instancer.instantiateVariableFont(font, {"wght": (400, 700)})  # keep 400-700 variable
    font.flavor = "woff2"
    font.save(out_path)
    print(f"{os.path.relpath(out_path, ROOT)}  {os.path.getsize(out_path) // 1024} KB  ({len(charset)} chars requested)")


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    paths = {}
    for i, n in enumerate(("SC", "TC")):
        if len(sys.argv) > 2:
            paths[n] = sys.argv[1 + i]
        else:
            dest = os.path.join("/tmp", f"NotoSans{n}.ttf")
            if not os.path.exists(dest):
                print("downloading", n)
                urllib.request.urlretrieve(URL.format(lc=n.lower(), n=n), dest)
            paths[n] = dest
    src = chars_in_source()
    build(paths["SC"], src | codec_hanzi("gb2312", range(0xB0, 0xF8)), os.path.join(OUT, "NotoSansSC-subset.woff2"))
    build(paths["TC"], src | codec_hanzi("big5", range(0xA4, 0xC7)), os.path.join(OUT, "NotoSansTC-subset.woff2"))


if __name__ == "__main__":
    main()
