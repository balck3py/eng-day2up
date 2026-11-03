"""Offline regression: uv run --with httpx python -m unittest discover -s scripts -p 'test_import_ecdict.py'."""
import unittest
from unittest.mock import patch

import httpx
import import_ecdict


class ImportRetryTest(unittest.TestCase):
    def test_committed_batch_with_lost_response_is_idempotent(self):
        stored = {}
        calls = []

        class Client:
            def post(self, url, *, json, params, headers):
                calls.append(json)
                self.assert_upsert(params, headers)
                for row in json:
                    stored[row['import_key']] = row
                if len(calls) == 1:
                    raise httpx.ReadError('response lost after commit')
                return httpx.Response(201)

            @staticmethod
            def assert_upsert(params, headers):
                assert params == {'on_conflict': 'import_key'}
                assert 'resolution=merge-duplicates' in headers['Prefer']

        db = import_ecdict.Supabase.__new__(import_ecdict.Supabase)
        db.url = 'https://test/rest/v1'
        db.client = Client()
        with patch.object(import_ecdict.time, 'sleep'):
            db.insert_entries([{'word': 'hello', 'translation': '你好'}])
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0], calls[1])
        self.assertEqual(len(stored), 1)
        db.insert_entries([{'translation': '你好', 'word': 'hello'}, {'word': 'hello', 'translation': '你好'}])
        self.assertEqual(len(calls[2]), 1)
        self.assertEqual(calls[0][0]['import_key'], calls[2][0]['import_key'])
        self.assertEqual(len(stored), 1)


if __name__ == '__main__':
    unittest.main()
