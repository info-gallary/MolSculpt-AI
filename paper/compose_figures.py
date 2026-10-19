"""Compose page-wide figures with their captions (Times New Roman, 8 pt) so
they can float at the top of a two-column page in the DOCX.
Usage: python paper/compose_figures.py paper/figures
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

DPI = 300
WIDTH_IN = 6.87
FONT = "C:/Windows/Fonts/times.ttf"

FIGURES = [
    ("diagram-arch.png", "float-arch.png", 1.0,
     "Fig. 2. System architecture. Camera frames never leave the browser; the cheminformatics engine is shared by "
     "the browser and the agent server; the Groq API key stays on the local server."),
    ("diagram-pipeline.png", "float-pipeline.png", 0.80,
     "Fig. 3. Gesture-recognition pipeline: pointer filtering and mapping (left), pinch state machine with hysteresis "
     "(centre), pose classification with stillness-gated hold timers (right), and routing to the editor or to "
     "user-interface controls (bottom)."),
]


def compose(src, dst, scale, caption, folder):
    total_w = int(WIDTH_IN * DPI)
    img = Image.open(folder / src).convert("RGB")
    w = int(total_w * scale)
    h = int(img.height * w / img.width)
    img = img.resize((w, h), Image.LANCZOS)
    font = ImageFont.truetype(FONT, int(8 / 72 * DPI))
    draw_probe = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    # Wrap the caption to the full text width.
    words, lines, line = caption.split(), [], ""
    for word in words:
        trial = f"{line} {word}".strip()
        if draw_probe.textlength(trial, font=font) > total_w - 20:
            lines.append(line)
            line = word
        else:
            line = trial
    lines.append(line)
    line_h = int(font.size * 1.18)
    gap = int(0.08 * DPI)
    canvas = Image.new("RGB", (total_w, h + gap + line_h * len(lines) + int(0.04 * DPI)), "white")
    canvas.paste(img, ((total_w - w) // 2, 0))
    draw = ImageDraw.Draw(canvas)
    y = h + gap
    for ln in lines:
        lw = draw.textlength(ln, font=font)
        draw.text(((total_w - lw) / 2, y), ln, fill="black", font=font)
        y += line_h
    canvas.save(folder / dst, dpi=(DPI, DPI))
    print(dst, canvas.size)


if __name__ == "__main__":
    folder = Path(sys.argv[1])
    for args in FIGURES:
        compose(*args, folder)
