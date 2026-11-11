"""In-memory mutation controls for the annotation checker; no product execution."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).parent
spec = importlib.util.spec_from_file_location('corpus_checker', ROOT / 'check_corpus.py')
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class IntegrityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = checker.load(ROOT / 'corpus.json')

    def reject(self, change, message):
        data = copy.deepcopy(self.fixture)
        change(data)
        with self.assertRaisesRegex(ValueError, message):
            checker.validate(data)

    def test_frozen_corpus(self):
        self.assertEqual(checker.validate(self.fixture)['cases'], 32)

    def test_duplicate_case(self):
        self.reject(lambda d: d['cases'].append(d['cases'][0]), 'duplicate case')

    def test_duplicate_source_version(self):
        self.reject(lambda d: d['sources'].append(d['sources'][0]), 'duplicate source version')

    def test_unknown_version(self):
        self.reject(lambda d: d['cases'][0]['expected_claims'][0]['evidence'][0].update(version='99'), 'exact selected')

    def test_invented_section(self):
        self.reject(lambda d: d['cases'][0]['expected_claims'][0]['evidence'][0].update(section='p999'), 'invented section')

    def test_altered_quote(self):
        self.reject(lambda d: d['cases'][0]['expected_claims'][0]['evidence'][0].update(quote='invented'), 'quote mismatch')

    def test_forbidden_candidate(self):
        self.reject(lambda d: d['cases'][0]['expected_claims'][0].update(candidate_id='item-b'), 'candidate not allowed')

    def test_revoked_disclosure(self):
        self.reject(lambda d: d['cases'][0].update(disclosure_revoked=['capture-a']), 'revoked citation')

    def test_unreadable_citation(self):
        def change(d):
            s = next(s for s in d['sources'] if s['id'] == 'capture-a')
            s.update(readable=False, sections={})
        self.reject(change, 'unreadable citation')

    def test_effect_authority(self):
        self.reject(lambda d: d['cases'][0].update(effects_allowed=['merge']), 'no effect authority')

    def test_probability_claim(self):
        self.reject(lambda d: d['cases'][0].update(score_semantics='calibrated'), 'not probabilities')

    def test_changed_version_application(self):
        self.reject(lambda d: d['cases'][4].update(abstain_from=['other']), 'hold application')

    def test_missing_baseline(self):
        def change(d):
            c = next(c for c in d['cases'] if c['id'] == 'maint-no-baseline')
            c['expected_claims'][0]['label'] = 'due_2030_04_01'
        self.reject(change, 'without baseline')

    def test_electrical_overclaim(self):
        def change(d):
            c = next(c for c in d['cases'] if c['id'] == 'qa-electrical')
            c['expected_claims'][0]['label'] = 'safe_breaker'
        self.reject(change, 'unsafe affirmative')

    def test_untrusted_instruction_boundary(self):
        def change(d):
            c = next(c for c in d['cases'] if c['id'] == 'qa-injection')
            c['abstain_from'].remove('expand_scope')
        self.reject(change, 'untrusted text')

    def test_bounded_route(self):
        def change(d):
            c = next(c for c in d['cases'] if c['id'] == 'qa-location')
            c['expected_route'] = 'delete_everything'
        self.reject(change, 'route not bounded')

    def test_duplicate_json_keys(self):
        with self.assertRaisesRegex(ValueError, 'duplicate JSON key'):
            json.loads('{"a":1,"a":2}', object_pairs_hook=checker.strict_pairs)

    def test_repeat_dismissal(self):
        self.reject(lambda d: next(c for c in d['cases'] if c['id'] == 'review-corrected')['repeat_expectation'].update(dismissed_same_versions='reopen'), 'repeat expectations')


if __name__ == '__main__':
    unittest.main()
