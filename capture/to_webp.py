# capture.mjs が出力した PNG を WebP に変換して、元の PNG を消す。
# スクリーンショットは 150〜250 枚になる見込みで、PNG のままだと
# リポジトリが数十MB 単位で膨らむため。
#
# 表示幅は 750px に揃える（スマホ実機で見たときに十分な解像度が出る大きさ）。
import sys
import pathlib
from PIL import Image

TARGET_W = 750
QUALITY = 82


def main(folder: str) -> int:
    d = pathlib.Path(folder)
    pngs = sorted(d.glob('*.png'))
    if not pngs:
        return 0

    total_before = total_after = 0
    for p in pngs:
        with Image.open(p) as im:
            im = im.convert('RGB')
            if im.width > TARGET_W:
                h = round(im.height * TARGET_W / im.width)
                im = im.resize((TARGET_W, h), Image.LANCZOS)
            out = p.with_suffix('.webp')
            im.save(out, 'WEBP', quality=QUALITY, method=6)
        total_before += p.stat().st_size
        total_after += out.stat().st_size
        p.unlink()

    print('WebP 変換: %d枚  %.1fMB -> %.1fMB'
          % (len(pngs), total_before / 1048576, total_after / 1048576))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else '.'))
