"""Write a byte-reproducible two-floor public-only IFC publication fixture."""

import argparse
import shutil
import uuid
from pathlib import Path

import test_publish
from publish import publish, canonical, sha


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    destination = args.output.resolve()
    if destination.exists():
        parser.error('output path already exists')
    # UUIDv5 constants make source, map, receipt and derivative bytes repeatable.
    counter = iter(range(1, 100))
    test_publish.uid = lambda: str(uuid.uuid5(uuid.NAMESPACE_URL,
                                             f'https://houseatlas.invalid/synthetic-ifc/{next(counter)}'))
    case = test_publish.PublicationTests('test_two_floors_share_source_and_map_pins')
    case.setUp()
    try:
        case.add_second_floor()
        destination.mkdir(parents=True)
        inputs = destination / 'inputs'; inputs.mkdir()
        for name, source in case.paths.items():
            target = inputs / name
            shutil.copyfile(source, target)
            if name == 'converter': target.chmod(0o700)
        publication_id = str(uuid.uuid5(uuid.NAMESPACE_URL,
                                        'https://houseatlas.invalid/synthetic-ifc/publication'))
        receipt = publish(inputs/'source.json', inputs/'source.ifc', inputs/'map.json',
                          inputs/'converter', inputs/'config.json', publication_id,
                          destination/'publication')
        (destination/'receipt.sha256').write_text(sha(canonical(receipt)) + '\n')
    except BaseException:
        shutil.rmtree(destination, ignore_errors=True)
        raise
    finally:
        case.doCleanups()


if __name__ == '__main__':
    main()
