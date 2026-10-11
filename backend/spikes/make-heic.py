"""Encode a PNG as HEIC (HEVC). Fixture generation only: no JS package encodes HEIC.

Usage: PYTHONPATH=<dir with the pillow and pillow_heif wheels unpacked> python3 make-heic.py in.png out.heic
"""

import sys

from PIL import Image
import pillow_heif

pillow_heif.register_heif_opener()
Image.open(sys.argv[1]).convert("RGB").save(sys.argv[2], format="HEIF", quality=75)
