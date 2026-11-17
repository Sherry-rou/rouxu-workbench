# -*- coding: utf-8 -*-
"""生成柔序工作台 PWA 应用图标（192/512/180 + maskable）。"""
import os
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.abspath(__file__))
ICON_DIR = os.path.join(BASE, "icons")
os.makedirs(ICON_DIR, exist_ok=True)

BG = (123, 174, 140)      # #7BAE8C
FG = (255, 255, 255)      # 白色
CHAR = "柔"


def find_font():
    candidates = [
        r"C:\Windows\Fonts\msyhbd.ttc",
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\msyhl.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\Deng.ttf",
        r"C:\Windows\Fonts\Dengb.ttf",
        r"C:\Windows\Fonts\simsun.ttc",
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return None


def draw_symbol(draw, size, font_path):
    """优先渲染汉字，找不到中文字体时回退为叶子图形。"""
    if font_path:
        try:
            font = ImageFont.truetype(font_path, int(size * 0.62))
            bbox = draw.textbbox((0, 0), CHAR, font=font)
            w = bbox[2] - bbox[0]
            h = bbox[3] - bbox[1]
            x = (size - w) / 2 - bbox[0]
            y = (size - h) / 2 - bbox[1]
            draw.text((x, y), CHAR, font=font, fill=FG)
            return
        except Exception:
            pass

    # 叶子回退图形
    s = size / 24.0
    leaf = [
        (10 * s, 4 * s),
        (16 * s, 4 * s),
        (20 * s, 10 * s),
        (18 * s, 20 * s),
        (8 * s, 20 * s),
        (5 * s, 12 * s),
    ]
    draw.polygon(leaf, fill=FG)
    draw.line([(11 * s, 20 * s), (13 * s, 7 * s)], fill=BG, width=max(1, int(1.6 * s)))


def make_icon(size, path, rounded=True):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        radius = int(size * 0.22)
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=BG)
    else:
        d.rectangle([0, 0, size - 1, size - 1], fill=BG)
    draw_symbol(d, size, find_font())
    img.save(path, "PNG")
    print("OK", path)


make_icon(512, os.path.join(ICON_DIR, "icon-512.png"), rounded=True)
make_icon(192, os.path.join(ICON_DIR, "icon-192.png"), rounded=True)
make_icon(180, os.path.join(ICON_DIR, "icon-180.png"), rounded=True)
make_icon(512, os.path.join(ICON_DIR, "maskable-512.png"), rounded=False)
print("DONE")
