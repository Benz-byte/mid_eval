import json
import pandas as pd

source_path = r"C:\Users\jap\Downloads\CCS COURSE OFFERING 2NDSEM 26-27 8.24.2026.xls"
excel = pd.ExcelFile(source_path)
print(json.dumps(excel.sheet_names))
for sheet_name in excel.sheet_names:
    data = pd.read_excel(source_path, sheet_name=sheet_name, header=None)
    print("---", sheet_name, data.shape)
    print(data.head(40).to_string(index=True, header=False))
