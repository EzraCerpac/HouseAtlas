"""Write a deterministic two-floor, one-room, two-occurrence public IFC fixture."""

import argparse
import json
import shutil
import uuid
from pathlib import Path

import test_publish
import test_publish_v2
from publish import publish, canonical, sha


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    destination = args.output.resolve()
    if destination.exists():
        parser.error('output path already exists')
    counter = iter(range(1, 100))
    test_publish.uid = lambda: str(uuid.uuid5(
        uuid.NAMESPACE_URL, f'https://houseatlas.invalid/synthetic-ifc-v2/{next(counter)}'))
    case = test_publish_v2.PublicationV2Tests('test_one_logical_room_two_floor_occurrences')
    case.setUp()
    try:
        destination.mkdir(parents=True)
        inputs = destination / 'inputs'; inputs.mkdir()
        for name, source in case.base.paths.items():
            target = inputs / name
            shutil.copyfile(source, target)
            if name == 'converter': target.chmod(0o700)
        publication_id = str(uuid.uuid5(
            uuid.NAMESPACE_URL, 'https://houseatlas.invalid/synthetic-ifc-v2/publication'))
        receipt = publish(inputs/'source.json', inputs/'source.ifc', inputs/'map.json',
                          inputs/'converter', inputs/'config.json', publication_id,
                          destination/'publication')
        (destination/'receipt.sha256').write_text(sha(canonical(receipt)) + '\n')
        semantic_map = json.loads((inputs/'map.json').read_text())
        scope = {key: semantic_map[key] for key in ('workspaceId','homeId','buildingId')}
        root = (f"/api/atlas/ifc/v2/workspaces/{scope['workspaceId']}/homes/"
                f"{scope['homeId']}/buildings/{scope['buildingId']}/publications/"
                f"{publication_id}")
        scene_floors = []
        for row in receipt['floors']:
            floor = row['floor']; floor_id = floor['floorId']
            artifacts = {key: {'sha256': item['sha256'], 'bytes': item['bytes'],
                               'href': f'{root}/floors/{floor_id}/artifacts/{key}'}
                         for key, item in row['artifacts'].items()}
            occurrences = [occ['spaceOccurrenceId'] for room in semantic_map['rooms']
                           for occ in room['occurrences'] if occ['floorId'] == floor_id]
            scene_floors.append({**floor, 'artifacts': artifacts,
                                 'spaceOccurrenceIds': sorted(occurrences)})
        scene = {'schema': 'houseatlas.ifc-scene-read.v2',
                 'availability': 'ready', 'scope': scope,
                 'selection': {
                     'revision': str(uuid.uuid5(uuid.NAMESPACE_URL,
                         'https://houseatlas.invalid/synthetic-ifc-v2/selection')),
                     'mode': 'published', 'publicationId': publication_id},
                 'publication': {key: receipt[key] for key in
                     ('publicationId','sourceRevisionId','sourceRevisionSha256',
                      'sourceIfcSha256','semanticMapRevisionId','semanticMapSha256')},
                 'axes': {'source': {'units':'mm','upAxis':'Z'},
                          'glb': {'units':'m','upAxis':'Y'},
                          'sourceToGlb': receipt['axes']['sourceToGlb'],
                          'physicalRegistration': {'status':'unverified','transform':None}},
                 'floors': scene_floors,
                 'rooms': semantic_map['rooms'],
                 'electricalGroups': semantic_map['electricalGroups'],
                 'semantics': {'sha256': receipt['semanticArtifact']['sha256'],
                               'bytes': receipt['semanticArtifact']['bytes'],
                               'href': f'{root}/artifacts/semantics'},
                 'overlays': {'publicationId': publication_id,
                              'semanticMapRevisionId': receipt['semanticMapRevisionId'],
                              'roomKey': 'roomId',
                              'spaceKey': 'spaceOccurrenceId',
                              'electricalGroupKey': 'groupId'}}
        scene['publication']['validation'] = receipt['validation']['status']
        (destination/'scene-read.json').write_bytes(canonical(scene))
    except BaseException:
        shutil.rmtree(destination, ignore_errors=True)
        raise
    finally:
        case.doCleanups()


if __name__ == '__main__':
    main()
