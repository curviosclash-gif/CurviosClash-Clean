"""Create WebP game variants; retain all original model and animation data.

Textures keep their pixels (lossless WebP) except for two cases that cost memory without
showing on screen: 1025..2048 px images are halved to MAX_TEXTURE_EDGE and encoded lossy
(colour and normal maps) or lossless (data maps), and single-colour images shrink to
CONSTANT_EDGE. The sky texture of BlackHole01 (4096 px) is left alone.

Run with Python and Pillow: python scripts/optimize-garden-glb.py
Original downloaded assets are never modified. Requires Pillow with WebP support.
"""
import io
import json
import struct
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/models/downloaded_cc0/pm-avatar-garden'
TARGET = ROOT / 'assets/models/optimized_cc0/pm-avatar-garden'
MAX_TEXTURE_EDGE = 1024
RESIZE_FROM_EDGE = 2048  # larger images (the galaxy sky) are showcase content and stay as they are
CONSTANT_EDGE = 4
LOSSY_QUALITY = 90


def is_constant(image):
    low, high = zip(*image.getextrema())
    return low == high


def encode(original, name):
    """Return (webp bytes, pixels the game still sees) for one texture."""
    if is_constant(original):
        small = original.resize((CONSTANT_EDGE, CONSTANT_EDGE), Image.NEAREST)
        return lossless(small), small
    edge = max(original.size)
    if MAX_TEXTURE_EDGE < edge <= RESIZE_FROM_EDGE:
        scale = MAX_TEXTURE_EDGE / edge
        small = original.resize((round(original.width * scale), round(original.height * scale)), Image.LANCZOS)
        if 'metallic' in name.lower():
            return lossless(small), small
        encoded = io.BytesIO()
        small.save(encoded, format='WEBP', quality=LOSSY_QUALITY, method=6)
        return encoded.getvalue(), small
    return lossless(original), original


def lossless(image):
    encoded = io.BytesIO()
    image.save(encoded, format='WEBP', lossless=True, exact=True, method=6)
    return encoded.getvalue()


def optimize(source):
    data = source.read_bytes()
    json_length = struct.unpack_from('<I', data, 12)[0]
    document = json.loads(data[20:20 + json_length])
    binary = data[28 + json_length:]
    image_views = {image['bufferView']: image for image in document.get('images', [])}
    result = bytearray()
    for index, view in enumerate(document['bufferViews']):
        offset = view.get('byteOffset', 0)
        payload = binary[offset:offset + view['byteLength']]
        if index in image_views:
            original = Image.open(io.BytesIO(payload)).convert('RGBA')
            candidate, expected = encode(original, image_views[index].get('name', ''))
            decoded = Image.open(io.BytesIO(candidate)).convert('RGBA')
            assert decoded.size == expected.size
            if decoded.size == original.size:
                assert decoded.tobytes() == original.tobytes()  # untouched size means untouched pixels
            if len(candidate) < len(payload):
                payload = candidate
                image_views[index]['mimeType'] = 'image/webp'
        result.extend(b'\x00' * (-len(result) % 4))
        view['byteOffset'] = len(result)
        view['byteLength'] = len(payload)
        result.extend(payload)
    # WebP is an explicit glTF extension, supported by the installed Three loader.
    for texture in document.get('textures', []):
        image_index = texture.get('source')
        if image_index is not None and document['images'][image_index]['mimeType'] == 'image/webp':
            texture.setdefault('extensions', {})['EXT_texture_webp'] = {'source': texture.pop('source')}
    for key in ['extensionsUsed', 'extensionsRequired']:
        if any(i['mimeType'] == 'image/webp' for i in document.get('images', [])):
            document.setdefault(key, [])
            if 'EXT_texture_webp' not in document[key]:
                document[key].append('EXT_texture_webp')
    result.extend(b'\x00' * (-len(result) % 4))
    document['buffers'][0]['byteLength'] = len(result)
    encoded = json.dumps(document, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    output = struct.pack('<III', 0x46546C67, 2, 28 + len(encoded) + len(result))
    output += struct.pack('<II', len(encoded), 0x4E4F534A) + encoded
    output += struct.pack('<II', len(result), 0x004E4942) + result
    TARGET.mkdir(parents=True, exist_ok=True)
    (TARGET / source.name).write_bytes(output)
    print(f'{source.name}: {len(data)} -> {len(output)} bytes', flush=True)


if __name__ == '__main__':
    for source in sorted(SOURCE.glob('*.glb')):
        optimize(source)
