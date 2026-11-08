# -*- coding: utf-8 -*-
"""
课堂点名 · 应用图标生成脚本

生成 assets/icon.ico（多尺寸）与 assets/icon-256.png。
首次打包前运行：python build-icon.py
依赖：pip install pillow
"""
from PIL import Image, ImageDraw

S = 256
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 渐变背景（垂直）
top = (59, 130, 246)   # #3B82F6
bot = (37, 99, 235)    # #2563EB
for y in range(S):
    t = y / (S - 1)
    r = int(top[0] * (1 - t) + bot[0] * t)
    g = int(top[1] * (1 - t) + bot[1] * t)
    b = int(top[2] * (1 - t) + bot[2] * t)
    d.line([(0, y), (S, y)], fill=(r, g, b, 255))

# 圆角遮罩
mask = Image.new('L', (S, S), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, S - 1, S - 1], radius=56, fill=255)
img.putalpha(mask)

# 白色人物（头 + 身体）
cx, cy = S // 2, 100
r = 46
d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 255))
d.ellipse([cx - 78, cy + 58, cx + 78, cy + 150], fill=(255, 255, 255, 255))

# 头部镂空（形成环形头像）
inner_r = 30
d.ellipse([cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r], fill=(59, 130, 246, 255))

# 右下角绿色勾选圆
gcx, gcy = S - 64, S - 64
gr = 40
d.ellipse([gcx - gr, gcy - gr, gcx + gr, gcy + gr], fill=(34, 197, 94, 255))
# 勾
d.line([(gcx - 16, gcy + 2), (gcx - 2, gcy + 16), (gcx + 18, gcy - 14)],
       fill=(255, 255, 255, 255), width=12, joint='curve')

img.save('assets/icon-256.png')
img.save('assets/icon.ico',
         sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('图标已生成：assets/icon.ico, assets/icon-256.png')
