#!/usr/bin/env python3
"""Собрать все CSV из папки в один XLSX (лист = имя файла). Используется workflow amocrm-extract.
Аргументы: <csv_dir> <out.xlsx>. Ничего не выдумывает — просто переносит содержимое CSV в листы.
CSV — UTF-8 (возможен BOM), разделитель запятая (RFC4180)."""
import csv
import sys
from pathlib import Path

from openpyxl import Workbook


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: csv-to-xlsx.py <csv_dir> <out.xlsx>", file=sys.stderr)
        return 2
    csv_dir = Path(sys.argv[1])
    out = Path(sys.argv[2])
    files = sorted(csv_dir.glob("*.csv"))
    if not files:
        print(f"нет csv в {csv_dir}", file=sys.stderr)
        return 1

    wb = Workbook()
    wb.remove(wb.active)
    for f in files:
        title = f.stem[:31]  # лимит имени листа Excel — 31 символ
        ws = wb.create_sheet(title=title)
        with f.open(encoding="utf-8-sig", newline="") as fh:
            for row in csv.reader(fh):
                ws.append(row)
    wb.save(out)
    print(f"XLSX собран: {out} ({len(files)} листов)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
