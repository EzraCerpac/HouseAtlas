"""Synthetic two-space/one-room checks for the separate v2 publication profile."""

import json
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

import test_publish
from publish import PublicationError, canonical, publish, sha


V2_CONVERTER = test_publish.FIXTURE_CONVERTER.replace(
    "room=next(r for r in semantic['rooms'] if r['floorId']==cfg['floor']['floorId'])\n"
    "room_id=room['roomId']; mesh_name='ha-room/'+room_id",
    "room,occ=next((r,o) for r in semantic['rooms'] for o in r['occurrences'] "
    "if o['floorId']==cfg['floor']['floorId'])\n"
    "room_id=room['roomId']; occurrence_id=occ['spaceOccurrenceId']\n"
    "mesh_name='ha-space/'+room_id+'/'+hashlib.sha256(occurrence_id.encode()).hexdigest()"
).replace(
    "'profile':'houseatlas.ifc-floorplan.v1'",
    "'profile':'houseatlas.ifc-floorplan.v2'"
).replace(
    "'entityType':'room',\n                       'entityId':room_id,'ifcGlobalId':room['ifcSpaceGlobalId']",
    "'entityType':'spaceOccurrence',\n                       'roomId':room_id,"
    "'spaceOccurrenceId':occurrence_id,'ifcGlobalId':occ['ifcSpaceGlobalId']"
).replace(
    "'spaces':[{'entityId':room_id,'ifcGlobalId':room['ifcSpaceGlobalId']",
    "'spaces':[{'roomId':room_id,'spaceOccurrenceId':occurrence_id,"
    "'ifcGlobalId':occ['ifcSpaceGlobalId']"
)


class PublicationV2Tests(unittest.TestCase):
    def setUp(self):
        self.base = test_publish.PublicationTests('test_two_floors_share_source_and_map_pins')
        self.base.setUp()
        self.addCleanup(self.base.doCleanups)
        second_room = self.base.add_second_floor()
        room_id = self.base.entity_id
        occurrence_one = 'synthetic-space-one'
        occurrence_two = 'synthetic-space-two'
        ifc = self.base.paths['source.ifc'].read_text()
        ifc = ifc.replace(f"IFCIDENTIFIER('{second_room}')",
                          f"IFCTEXT('{room_id}')")
        ifc = ifc.replace('(#3,#4));', '(#3,#4,#30));')
        ifc = ifc.replace('(#14,#15));', '(#14,#15,#31));')
        ifc = ifc.replace('ENDSEC;\nEND-ISO-10303-21;',
                          "#30=IFCPROPERTYSINGLEVALUE('OccurrenceKey',$,"
                          f"IFCTEXT('{occurrence_one}'),$);\n"
                          "#31=IFCPROPERTYSINGLEVALUE('OccurrenceKey',$,"
                          f"IFCTEXT('{occurrence_two}'),$);\n"
                          'ENDSEC;\nEND-ISO-10303-21;')
        first = self.base.semantic_map['rooms'][0]
        second = self.base.semantic_map['rooms'][1]
        self.base.semantic_map['schema'] = 'houseatlas.ifc-semantic-map.v2'
        self.base.semantic_map['rooms'] = [{
            'roomId':room_id, 'atlasPlaceId':None, 'packagePlace':None,
            'displayName':'Synthetic combined room',
            'occurrences':[
                {'spaceOccurrenceId':occurrence_one,
                 'ifcSpaceGlobalId':first['ifcSpaceGlobalId'],
                 'floorId':first['floorId']},
                {'spaceOccurrenceId':occurrence_two,
                 'ifcSpaceGlobalId':second['ifcSpaceGlobalId'],
                 'floorId':second['floorId']}]}]
        self.base.paths['converter'].write_text(V2_CONVERTER)
        self.base.paths['converter'].chmod(0o700)
        self.base.config['converter']['sha256'] = sha(V2_CONVERTER.encode())
        self.base.replace_ifc(ifc)
        self.room_id = room_id
        self.occurrences = {occurrence_one, occurrence_two}

    def run_publish(self, target='v2-output'):
        b = self.base
        return publish(b.paths['source.json'], b.paths['source.ifc'],
                       b.paths['map.json'], b.paths['converter'], b.paths['config.json'],
                       test_publish.uid(), b.root/target)

    def test_one_logical_room_two_floor_occurrences(self):
        row = self.run_publish()
        self.assertEqual(row['profile'], 'houseatlas.ifc-publication.v2')
        self.assertEqual(row['validation']['spaceOccurrenceCount'], 2)
        self.assertEqual(len(row['floors']), 2)
        seen = set()
        for floor in row['floors']:
            plan = json.loads((self.base.root/'v2-output'/floor['artifacts']
                               ['floorplanFeatures']['path']).read_text())
            self.assertEqual(plan['profile'], 'houseatlas.ifc-floorplan.v2')
            self.assertEqual(plan['spaces'][0]['roomId'], self.room_id)
            seen.add(plan['spaces'][0]['spaceOccurrenceId'])
        self.assertEqual(seen, self.occurrences)

    def test_duplicate_occurrence_key_rejected(self):
        b = self.base
        text = b.paths['source.ifc'].read_text().replace(
            'synthetic-space-two', 'synthetic-space-one')
        b.replace_ifc(text)
        with self.assertRaises(PublicationError): self.run_publish()

    def test_missing_occurrence_key_rejected(self):
        b = self.base
        text = b.paths['source.ifc'].read_text().replace('(#14,#15,#31));',
                                                   '(#14,#15));')
        b.replace_ifc(text)
        with self.assertRaises(PublicationError): self.run_publish()

    def test_unmapped_ifc_electrical_circuit_rejected(self):
        b = self.base
        circuit_id = test_publish.uid()
        text = b.paths['source.ifc'].read_text().replace(
            'ENDSEC;\nEND-ISO-10303-21;',
            "#40=IFCDISTRIBUTIONCIRCUIT('0123456789ABCDEFGHIJKZ',$,"
            "'Synthetic circuit',$,$,.ELECTRICAL.);\n"
            "#41=IFCPROPERTYSET('1123456789ABCDEFGHIJKN',$,"
            "'HouseAtlas_Identity',$,(#42,#43));\n"
            f"#42=IFCPROPERTYSINGLEVALUE('EntityId',$,IFCTEXT('{circuit_id}'),$);\n"
            "#43=IFCPROPERTYSINGLEVALUE('SchemaVersion',$,IFCINTEGER(1),$);\n"
            "#44=IFCRELDEFINESBYPROPERTIES('2123456789ABCDEFGHIJKN',$,$,$,"
            "(#40),#41);\n"
            'ENDSEC;\nEND-ISO-10303-21;')
        b.replace_ifc(text)
        with self.assertRaisesRegex(PublicationError, 'unmapped v2 IFC electrical circuit'):
            self.run_publish()

    def test_svg_quotes_opaque_occurrence_safely(self):
        b = self.base
        quoted = 'synthetic-"quoted"-&-space'
        text = b.paths['source.ifc'].read_text().replace(
            'synthetic-space-two', quoted)
        b.semantic_map['rooms'][0]['occurrences'][1]['spaceOccurrenceId'] = quoted
        b.replace_ifc(text)
        row = self.run_publish()
        svgs = [(b.root/'v2-output'/floor['artifacts']['floorplan2d']['path']).read_text()
                for floor in row['floors']]
        ids = [element.attrib['data-space-occurrence-id']
               for svg in svgs for element in ET.fromstring(svg).iter()
               if 'data-space-occurrence-id' in element.attrib]
        self.assertIn(quoted, ids)


class CheckedInSceneV2Tests(unittest.TestCase):
    def test_scene_fixture_matches_publication_and_artifacts(self):
        root = Path(__file__).resolve().parents[2] / 'docs/canonical-ifc/fixtures/two-floor-v2'
        scene = json.loads((root/'scene-read.json').read_bytes())
        receipt = json.loads((root/'publication/publication.json').read_bytes())
        semantic = json.loads((root/'publication/semantics.json').read_bytes())
        self.assertEqual(scene['schema'], 'houseatlas.ifc-scene-read.v2')
        self.assertEqual(scene['publication']['publicationId'], receipt['publicationId'])
        self.assertEqual(scene['publication']['semanticMapSha256'], receipt['semanticMapSha256'])
        self.assertEqual(scene['rooms'], semantic['semanticMap']['rooms'])
        self.assertEqual((root/'receipt.sha256').read_text().strip(),
                         sha(canonical(receipt)))
        self.assertEqual(len(scene['rooms']), 1)
        self.assertEqual(len(scene['rooms'][0]['occurrences']), 2)
        for floor in scene['floors']:
            pinned = next(row for row in receipt['floors']
                          if row['floor']['floorId'] == floor['floorId'])
            occurrences = [occ['spaceOccurrenceId'] for room in scene['rooms']
                           for occ in room['occurrences'] if occ['floorId'] == floor['floorId']]
            self.assertEqual(floor['spaceOccurrenceIds'], sorted(occurrences))
            for key, artifact in floor['artifacts'].items():
                row = pinned['artifacts'][key]
                data = (root/'publication'/row['path']).read_bytes()
                self.assertEqual((artifact['sha256'],artifact['bytes']),
                                 (sha(data),len(data)))
                self.assertEqual((row['sha256'],row['bytes']),
                                 (sha(data),len(data)))
            plan = json.loads((root/'publication'/pinned['artifacts']
                               ['floorplanFeatures']['path']).read_bytes())
            self.assertEqual({x['spaceOccurrenceId'] for x in plan['spaces']},
                             set(occurrences))
        self.assertEqual((scene['semantics']['sha256'],scene['semantics']['bytes']),
                         (sha(canonical(semantic)),len(canonical(semantic))))


if __name__ == '__main__':
    unittest.main()
