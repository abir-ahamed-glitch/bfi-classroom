import os
import sys

file_path = r'E:\OFFICE FILES (backup)\Old hard disk documents\OLD Documents_Ex Hard Disk\All important documents\BFI\1st Batch\Result of Examination.doc'

with open(file_path, 'rb') as f:
    header = f.read(8)
    print("Header bytes:", header.hex())
    
    # Try to read it as plain text just in case it's RTF or HTML
    f.seek(0)
    try:
        content = f.read(1000).decode('utf-8', errors='ignore')
        print("Text snippet:", content[:200])
    except Exception as e:
        print("Error reading as text:", e)
