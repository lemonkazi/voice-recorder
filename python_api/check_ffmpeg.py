import subprocess
import sys
import os

def check_ffmpeg():
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
        print("✅ FFmpeg is installed and working")
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("❌ FFmpeg is not installed or not in PATH")
        print("\nTo install FFmpeg:")
        print("Ubuntu/Debian: sudo apt install ffmpeg")
        print("Mac: brew install ffmpeg") 
        print("Windows: Download from https://ffmpeg.org/download.html")
        print("\nOr use WAV files only with the alternative API.")
        return False

if __name__ == "__main__":
    check_ffmpeg()