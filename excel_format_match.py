import copy
import openpyxl
from openpyxl.utils import get_column_letter

ref_path = r"C:\Users\Admin\Downloads\CSD-facebook-posts-2026-10-28.xlsx"
out_path = r"C:\Users\Admin\AppData\Roaming\csd-desktop\data\collections\threads-coffee-20261029\outputs\01a18706-1440-79b3-8166-fa2d8c0e3483\posts.xlsx"

ref_wb = openpyxl.load_workbook(ref_path)
ref_ws = ref_wb.active
wb = openpyxl.load_workbook(out_path)
ws = wb.active

# Copy individual style components because style IDs belong to each workbook.
def apply_style(target, source):
    target.font = copy.copy(source.font)
    target.fill = copy.copy(source.fill)
    target.border = copy.copy(source.border)
    target.alignment = copy.copy(source.alignment)
    target.protection = copy.copy(source.protection)
    target.number_format = source.number_format


for cell in ws[1]:
    apply_style(cell, ref_ws["A1"])
for row in ws.iter_rows(min_row=2):
    for cell in row:
        apply_style(cell, ref_ws["A2"])

# Match sample worksheet behavior and dimensions.
ws.freeze_panes = "A2"
ws.auto_filter.ref = f"A1:{get_column_letter(ws.max_column)}{ws.max_row}"
ws.sheet_view.showGridLines = True
ws.row_dimensions[1].height = ref_ws.row_dimensions[1].height
for row_number in list(ws.row_dimensions):
    if row_number != 1:
        ws.row_dimensions[row_number].height = None

# Use the sample's widths for equivalent fields, rather than its column letters.
widths = {
    "post_id": 24, "published_at": 23, "query": 30,
    "platform": 18, "author_username": 30, "author_name": 30,
    "text": 60, "post_url": 43.42578125,
    "likes": 18, "replies": 18, "reposts": 18,
    "quotes": 18, "shares": 18, "collected_at": 23,
}
for c in range(1, ws.max_column + 1):
    letter = get_column_letter(c)
    header = ws.cell(1, c).value
    ws.column_dimensions[letter].width = widths.get(header, 24)

wb.save(out_path)
print(out_path)
