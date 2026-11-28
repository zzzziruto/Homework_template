import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import server


class StaticAssetTests(unittest.TestCase):
    def request(self, path):
        result = []
        handler = object.__new__(server.Handler)
        handler.path = path
        handler.reply = lambda status, body, mime=None: result.append((status, body, mime))
        handler.do_GET()
        return result[0]

    def test_preview_serves_modules_worklets_and_audio(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(server, 'ROOT', Path(directory)):
            for relative in ('party-client.mjs', 'motion.mjs', 'session.mjs', 'audio/audio-engine.mjs',
                             'audio/scratch-worklet.mjs', 'vendor/p5.party-0.16.0.js',
                             'assets/dj-layout.svg', 'music/Bad Romance.mp3'):
                target = Path(directory) / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(b'public asset')
                status, body, mime = self.request('/' + relative.replace(' ', '%20') + '?v=release')
                self.assertEqual(status, 200, relative)
                self.assertEqual(body, b'public asset')
                self.assertIsNotNone(mime)

    def test_resolved_asset_paths_cannot_expose_private_files(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(server, 'ROOT', Path(directory)):
            root = Path(directory)
            (root / 'assets').mkdir()
            (root / 'audio').mkdir()
            for relative in ('.certificates/server.key', 'data/session.json', 'server.py'):
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text('private fixture')
                self.assertEqual(self.request('/' + relative)[0], 404)
                self.assertEqual(self.request('/assets/../' + relative)[0], 404)
                self.assertEqual(self.request('/audio/%2e%2e/' + relative)[0], 404)


if __name__ == '__main__':
    unittest.main()
