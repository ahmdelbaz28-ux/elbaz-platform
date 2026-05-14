import os
import shutil
import glob

temp_dir = r"C:\Users\EWS-01\.gemini\antigravity\brain\6ef4737b-4c48-454c-a1ae-3582e04ead70\.tempmediaStorage"
target_logo = r"c:\Users\EWS-01\Downloads\Compressed\elbaz-platform-main\elbaz-platform-main\public\logo.png"

# Find all media files
files = glob.glob(os.path.join(temp_dir, "media_*.png"))
if not files:
    print("No media files found.")
    exit(1)

# Sort by modification time to get the latest
latest_file = max(files, key=os.path.getmtime)
print(f"Latest file: {latest_file}")

# Copy to target
shutil.copy2(latest_file, target_logo)
print(f"Copied to {target_logo}")
