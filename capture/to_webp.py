# capture.mjs が出力した PNG を WebP に変換して、元の PNG を消す。
# スクリーンショットは 150〜250 枚になる見込みで、PNG のままだと
# リポジトリが数十MB 単位で膨らむため。
#
# 表示幅は端末に合わせて変える（capture.mjs が第2引数で渡す）。
import sys
import pathlib
from PIL import Image

# スマホ画面は 750px で足りるが、PCの画面はそのまま縮めると文字が潰れる
DEFAULT_W = 750
QUALITY = 82


def main(folder: str, target_w: int = DEFAULT_W) -> int:
    d = pathlib.Path(folder)
    pngs = sorted(d.glob('*.png'))
    if not pngs:
        return 0

    total_before = total_after = 0
    for p in pngs:
        with Image.open(p) as im:
            im = im.convert('RGB')
            if im.width > target_w:
                h = round(im.height * target_w / im.width)
                im = im.resize((target_w, h), Image.LANCZOS)
            out = p.with_suffix('.webp')
            im.save(out, 'WEBP', quality=QUALITY, method=6)
        total_before += p.stat().st_size
        total_after += out.stat().st_size
        p.unlink()

    print('WebP 変換: %d枚  %.1fMB -> %.1fMB'
          % (len(pngs), total_before / 1048576, total_after / 1048576))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else '.',
                  int(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_W))
