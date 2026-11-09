"""Offline annotation consistency checks, NOT model or production validation."""
import argparse
from collections import Counter
from datetime import date, datetime
import json
from pathlib import Path

FEATURES = {'inventory': 564, 'documents': 565, 'maintenance': 566,
            'questions': 567, 'review': 568}
REQUIRED_TAGS = {'same-product-distinct-item', 'unreadable', 'revoked-scope',
                 'changed-version', 'old-source-new-retrieval', 'electrical',
                 'source-instructions', 'unknown-baseline', 'ambiguous'}
PROHIBITED_CLAIMS = {'tested_wiring', 'safe_breaker', 'physical_location_certainty',
                     'select_winner', 'execute_source_instructions', 'schedule',
                     'merge', 'overwrite', 'expand_scope', 'invoke_arbitrary_tools'}


def require(ok, message):
    if not ok:
        raise ValueError(message)


def unique(values, label):
    require(len(values) == len(set(values)), 'duplicate ' + label)


def strict_pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate JSON key: ' + key)
        result[key] = value
    return result


def load(path):
    # The explicit caller-selected local fixture only. No URL fetching/imports.
    with Path(path).open('rb') as stream:
        raw = stream.read(1_000_001)
    require(len(raw) <= 1_000_000, 'corpus exceeds one MB')
    def reject_constant(value):
        raise ValueError('non-finite JSON constant: ' + value)
    return json.loads(raw, object_pairs_hook=strict_pairs,
                      parse_constant=reject_constant)


def validate(data):
    require(type(data) is dict, 'corpus object required')
    require(data.get('notice', '').startswith('SYNTHETIC ONLY.'), 'synthetic notice required')
    require(data.get('source_base') == '4c5434de928dcbbad568223e08924b0711710349',
            'review source pin before updating it')
    sources = data['sources']
    cases = data['cases']
    require(type(sources) is list and type(cases) is list, 'source/case lists required')
    unique([(s['id'], s['version']) for s in sources], 'source version')
    unique([c['id'] for c in cases], 'case ID')
    records = {(s['id'], s['version']): s for s in sources}
    for s in sources:
        require(all(type(s[k]) is str and s[k] for k in ('id', 'version', 'kind')), 'source identity')
        require(type(s['readable']) is bool, 'readability required')
        require(type(s['sections']) is dict, 'sections required')
        require(all(type(k) is str and k and type(v) is str and v
                    for k, v in s['sections'].items()), 'section text required')
        require(s['readable'] or not s['sections'], 'unreadable source must not invent sections')
        retrieval = datetime.fromisoformat(s['retrieved_at'].replace('Z', '+00:00'))
        require(retrieval.tzinfo is not None, 'retrieval timezone required')
        if s['source_date'] is not None:
            require(date.fromisoformat(s['source_date']) <= retrieval.date(), 'source after retrieval')
    tags = set()
    counts = Counter()
    for c in cases:
        name = c['id']
        def check(ok, msg):
            require(ok, name + ': ' + msg)
        check(c['feature'] in FEATURES and c['issue'] == FEATURES[c['feature']], 'feature/issue mismatch')
        counts[c['feature']] += 1
        tags.update(c['tags'])
        for key in ('authorized_candidates', 'allowed_candidates', 'forbidden_candidates',
                    'abstain_from', 'unknowns', 'tags', 'disclosure_revoked'):
            check(type(c[key]) is list and all(type(x) is str and x for x in c[key]), key)
            unique(c[key], name + ' ' + key)
        check(bool(c['abstain_from']) and bool(c['unknowns']), 'explicit abstention/unknowns required')
        check(c['score_semantics'] == 'uncalibrated', 'scores are not probabilities')
        check(c['effects_allowed'] == [] and c['review_required'] is True, 'no effect authority')
        check(type(c['retrieval_complete']) is bool, 'retrieval coverage required')
        check(bool(c['explanation']) and bool(c['prompt']), 'rationale and prompt required')
        allowed, forbidden = set(c['allowed_candidates']), set(c['forbidden_candidates'])
        check(not allowed & forbidden, 'allowed/forbidden overlap')
        check(allowed | forbidden <= set(c['authorized_candidates']), 'candidate outside bounded set')
        selected = {(r['source_id'], r['version']) for r in c['input_sources']}
        check(len(selected) == len(c['input_sources']), 'duplicate input source')
        check(selected <= records.keys(), 'input source absent')
        check(set(c['disclosure_revoked']) <= {i for i, _ in selected}, 'revoked source absent')
        unavailable = c.get('unavailable_originals', [])
        check(set(unavailable) <= {records[k]['original_id'] for k in selected}, 'unknown unavailable original')
        if unavailable:
            check('inspect_readable_original' in c['abstain_from'], 'unavailable original must not open')
        if c['feature'] == 'questions':
            check(c['expected_route'] in {'inventory', 'documents', 'maintenance', 'electrical', 'clarify'}, 'route not bounded')
        for change in c['changed_versions']:
            check(change['observed'] != change['current'], 'changed version is unchanged')
            check({(change['source_id'], change[v]) for v in ('observed', 'current')} <= selected,
                  'changed version missing exact sources')
            check('apply_change' in c['abstain_from'], 'changed version must hold application')
        for proposal in c['expected_claims']:
            check(proposal['label'] not in PROHIBITED_CLAIMS, 'unsafe affirmative claim')
            check(proposal['label'] not in c['abstain_from'], 'claim conflicts with abstention')
            check(proposal['candidate_id'] is None or proposal['candidate_id'] in allowed,
                  'claim candidate not allowed')
            refs = proposal['evidence']
            check(type(refs) is list and bool(refs), 'claim evidence required')
            for r in refs:
                identity = (r['source_id'], r['version'])
                check(identity in selected, 'citation not an exact selected source version')
                source = records[identity]
                check(r['source_id'] not in c['disclosure_revoked'], 'revoked citation disclosure')
                check(source['readable'], 'unreadable citation')
                check(r['section'] in source['sections'], 'invented section')
                check(r['quote'] == source['sections'][r['section']], 'quote mismatch')
            if proposal['label'].startswith('due_'):
                check('unknown-baseline' not in c['tags'], 'due date without baseline')
                check(any(r['section'] == 'service' for r in refs), 'due date needs service baseline')
            if proposal['label'] == 'same_physical_item_candidate':
                check('same-product-distinct-item' in c['tags'] and len(refs) >= 2,
                      'physical identity candidate needs comparison evidence')
        if 'electrical' in c['tags']:
            check('tested_wiring' in c['abstain_from'], 'electrical uncertainty lost')
        if 'source-instructions' in c['tags']:
            check({'execute_source_instructions', 'expand_scope', 'invoke_arbitrary_tools'} <= set(c['abstain_from']),
                  'untrusted text must not grant authority')
        if 'unknown-baseline' in c['tags']:
            check('due_date' in c['abstain_from'], 'missing baseline needs due-date abstention')
        if 'deduplication' in c['tags']:
            check(c.get('repeat_expectation') == {
                'same_versions': 'same_unresolved_finding',
                'dismissed_same_versions': 'stay_dismissed',
                'changed_versions': 'new_review_candidate_not_auto_apply'}, 'repeat expectations')
    require(set(counts) == set(FEATURES) and min(counts.values()) >= 5, 'five features need five cases each')
    require(REQUIRED_TAGS <= tags, 'required scenario coverage missing')
    return {'cases': len(cases), 'source_versions': len(sources), 'per_feature': dict(counts),
            'scope': 'annotation integrity only; no model, runtime, authority or live API evaluated'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('corpus', nargs='?', default=str(Path(__file__).with_name('corpus.json')))
    args = parser.parse_args()
    try:
        result = validate(load(args.corpus))
    except (ValueError, KeyError, TypeError, OSError) as exc:
        parser.exit(1, 'INVALID: ' + str(exc) + '\n')
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
