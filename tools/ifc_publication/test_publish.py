"""Synthetic, local-only checks for the immutable IFC publication builder."""
import json
import os
import tempfile
import unittest
import uuid
from pathlib import Path

from publish import PublicationError, publish, sha, check_plan

FIXTURE_CONVERTER = '''#!/usr/bin/env python3
import argparse, hashlib, json, struct
from pathlib import Path
p=argparse.ArgumentParser()
for name in ('ifc','semantic-map','config','glb','floorplan'): p.add_argument('--'+name,required=True)
a=p.parse_args(); src=Path(a.ifc).read_bytes(); cfg=json.loads(Path(a.config).read_text())
semantic=json.loads(Path(a.semantic_map).read_text())
room=next(r for r in semantic['rooms'] if r['floorId']==cfg['floor']['floorId'])
room_id=room['roomId']; mesh_name='ha-room/'+room_id
binpart=struct.pack('<9f',0,0,0,1,0,0,0,1,0)+struct.pack('<3H',0,1,2)+b'\\0\\0'
doc={'asset':{'version':'2.0','extras':{'houseatlasIfcDerivative':{
 'profile':'houseatlas.ifc-derived-glb.v1','originalSha256':hashlib.sha256(src).hexdigest(),
 'originalBytes':len(src),'floorLabel':cfg['floor']['label'],'sourceUnits':'mm','sourceUpAxis':'Z',
 'glbUnits':'m','glbUpAxis':'Y','sourceToGlb':{'axisMap':['x','z','-y'],'scale':0.001},
 'converter':{'name':cfg['converter']['name'],'version':cfg['converter']['version'],
              'configSha256':cfg['converterConfigSha256']}}}},
 'buffers':[{'byteLength':42}],
 'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':36},{'buffer':0,'byteOffset':36,'byteLength':6}],
 'accessors':[{'bufferView':0,'componentType':5126,'count':3,'type':'VEC3'},
              {'bufferView':1,'componentType':5123,'count':3,'type':'SCALAR'}],
 'meshes':[{'name':mesh_name,'primitives':[{'attributes':{'POSITION':0},'indices':1,'mode':4}]}],
 'nodes':[{'name':mesh_name,'mesh':0}],'scenes':[{'nodes':[0]}],'scene':0}
j=json.dumps(doc,separators=(',',':'),sort_keys=True).encode(); j+=b' ' * (-len(j)%4)
glb=(b'glTF'+struct.pack('<II',2,28+len(j)+len(binpart))+struct.pack('<I',len(j))+
     b'JSON'+j+struct.pack('<I',len(binpart))+b'BIN\\0'+binpart)
Path(a.glb).write_bytes(glb)
plan={'profile':'houseatlas.ifc-floorplan.v1','sourceRevisionId':cfg['sourceRevisionId'],
      'sourceIfcSha256':cfg['sourceIfcSha256'],'semanticMapRevisionId':cfg['semanticMapRevisionId'],
      'units':'mm','upAxis':'Z','floor':cfg['floor'],
      'meshBindings':[{'meshIndex':0,'nodeIndex':0,'entityType':'room',
                       'entityId':room_id,'ifcGlobalId':room['ifcSpaceGlobalId']}],
      'spaces':[{'entityId':room_id,'ifcGlobalId':room['ifcSpaceGlobalId'],
                 'polygons':[[[0,0],[1000,0],[1000,1000],[0,1000]]]}]}
Path(a.floorplan).write_text(json.dumps(plan))
'''


def uid() -> str:
    return str(uuid.uuid4())


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.paths = {name: self.root / name for name in
                      ('source.json', 'source.ifc', 'map.json', 'converter', 'config.json')}
        self.entity_id = uid(); self.floor_id = uid(); self.map_id = uid()
        source_ifc = ("ISO-10303-21;\nHEADER;FILE_SCHEMA(('IFC4'));ENDSEC;\nDATA;\n"
                      "#1=IFCSPACE('0123456789ABCDEFGHIJKL',$,'Synthetic room',$,$);\n"
                      "#2=IFCPROPERTYSET('1123456789ABCDEFGHIJKL',$,'HouseAtlas_Identity',$,(#3,#4));\n"
                      f"#3=IFCPROPERTYSINGLEVALUE('EntityId',$,IFCIDENTIFIER('{self.entity_id}'),$);\n"
                      "#4=IFCPROPERTYSINGLEVALUE('SchemaVersion',$,IFCINTEGER(1),$);\n"
                      "#5=IFCRELDEFINESBYPROPERTIES('2123456789ABCDEFGHIJKL',$,$,$,(#1),#2);\n"
                      "#6=IFCBUILDINGSTOREY('3123456789ABCDEFGHIJKL',$,'Synthetic floor',$,$);\n"
                      "#7=IFCPROPERTYSET('1123456789ABCDEFGHIJKM',$,'HouseAtlas_Identity',$,(#8,#9));\n"
                      f"#8=IFCPROPERTYSINGLEVALUE('EntityId',$,IFCIDENTIFIER('{self.floor_id}'),$);\n"
                      "#9=IFCPROPERTYSINGLEVALUE('SchemaVersion',$,IFCINTEGER(1),$);\n"
                      "#10=IFCRELDEFINESBYPROPERTIES('2123456789ABCDEFGHIJKM',$,$,$,(#6),#7);\n"
                      "#11=IFCRELAGGREGATES('3123456789ABCDEFGHIJKM',$,$,$,#6,(#1));\n"
                      "ENDSEC;\nEND-ISO-10303-21;").encode()
        self.paths['source.ifc'].write_bytes(source_ifc)
        self.paths['converter'].write_text(FIXTURE_CONVERTER)
        self.paths['converter'].chmod(0o700)
        self.source = {'profile':'houseatlas.ifc-source-revision.v1',
                       'scope':{'workspaceId':uid(),'homeId':uid(),'buildingId':uid()},
                       'sourceId':uid(),'revisionId':uid(),'parentRevisionId':None,
                       'ifcAsset':{'assetId':uid(),'sha256':sha(source_ifc),'bytes':len(source_ifc)},
                       'authoringTool':{'name':'synthetic','version':'1'},
                       'declaredUnits':'mm','declaredUpAxis':'Z',
                       'semanticMapRevisionId':self.map_id,'semanticMapSha256':None}
        self.semantic_map = {'schema':'houseatlas.ifc-semantic-map.v1',
                             'semanticMapRevisionId':self.map_id,
                             'previousSemanticMapRevisionId':None,
                             'sourceRevisionId':self.source['revisionId'],
                             'ifcOriginalSha256':sha(source_ifc),
                             **self.source['scope'],
                             'floors':[{'floorId':self.floor_id,
                                        'ifcBuildingStoreyGlobalId':'3123456789ABCDEFGHIJKL',
                                        'atlasPlaceId':None,'displayName':'Synthetic floor'}],
                             'rooms':[{'roomId':self.entity_id,
                                       'floorId':self.floor_id,
                                       'ifcSpaceGlobalId':'0123456789ABCDEFGHIJKL',
                                       'atlasPlaceId':None,'packagePlace':None,
                                       'displayName':'Synthetic room'}],
                             'electricalGroups':[], 'transitions':[]}
        self.config = {'floors':[{'floorId':self.floor_id,
                                'ifcBuildingStoreyGlobalId':'3123456789ABCDEFGHIJKL',
                                'label':'Synthetic floor',
                                'elevationMm':None, 'floorToSource':None}],
                       'converter':{'name':'synthetic','version':'1',
                                    'sha256':sha(self.paths['converter'].read_bytes())}}
        self.save()

    def save(self):
        self.paths['map.json'].write_text(json.dumps(self.semantic_map))
        self.source['semanticMapSha256'] = sha(self.paths['map.json'].read_bytes())
        self.paths['source.json'].write_text(json.dumps(self.source))
        self.paths['config.json'].write_text(json.dumps(self.config))

    def run_publish(self, target='output'):
        return publish(self.paths['source.json'], self.paths['source.ifc'],
                       self.paths['map.json'], self.paths['converter'],
                       self.paths['config.json'], uid(), self.root / target)

    def test_synthetic_publication_has_bound_matching_artifacts(self):
        row = self.run_publish()
        self.assertEqual(row['validation']['converterRuns'], 2)
        self.assertEqual(len(row['floors']), 1)
        self.assertEqual(set(row['floors'][0]['artifacts']),
                         {'glb','floorplanFeatures','floorplan2d'})
        self.assertEqual(row['sourceIfcSha256'], self.source['ifcAsset']['sha256'])
        self.assertEqual(row['sourceRevisionSha256'], sha(json.dumps(
            self.source,sort_keys=True,separators=(',',':')).encode()))
        self.assertEqual(row['sourceRevisionRawFileSha256'],
                         sha(self.paths['source.json'].read_bytes()))
        for asset in [*row['floors'][0]['artifacts'].values(), row['semanticArtifact']]:
            data = (self.root / 'output' / asset['path']).read_bytes()
            self.assertEqual((sha(data),len(data)), (asset['sha256'],asset['bytes']))
        svg_path = row['floors'][0]['artifacts']['floorplan2d']['path']
        self.assertIn(self.entity_id, (self.root/'output'/svg_path).read_text())

    def test_stale_source_digest_and_semantic_revision_rejected(self):
        self.source['ifcAsset']['sha256'] = 'a'*64
        self.save()
        with self.assertRaises(PublicationError): self.run_publish()
        self.source['ifcAsset']['sha256'] = sha(self.paths['source.ifc'].read_bytes())
        self.semantic_map['sourceRevisionId'] = uid()
        self.save()
        with self.assertRaises(PublicationError): self.run_publish()

    def test_converter_pin_rejected_before_execution(self):
        self.config['converter']['sha256'] = 'a'*64
        self.save()
        with self.assertRaises(PublicationError): self.run_publish()

    def test_floor_global_id_not_in_ifc_rejected(self):
        self.config['floors'][0]['ifcBuildingStoreyGlobalId'] = '3123456789ABCDEFGHIJKM'
        self.save()
        with self.assertRaises(PublicationError): self.run_publish()

    def test_unverified_elevation_and_transform_rejected(self):
        self.config['floors'][0]['elevationMm'] = 0
        self.save()
        with self.assertRaises(PublicationError): self.run_publish()
        self.config['floors'][0]['elevationMm'] = None
        self.config['floors'][0]['floorToSource'] = [1,0,0,0, 0,1,0,0,
                                                    0,0,1,0, 0,0,0,1]
        self.save()
        with self.assertRaises(PublicationError): self.run_publish()

    def test_shared_occurrence_pset_rejected(self):
        ifc = self.paths['source.ifc'].read_text().replace(
            'ENDSEC;\nEND-ISO-10303-21;',
            "#12=IFCSPACE('0123456789ABCDEFGHIJKM',$,'Other room',$,$);\n"
            "#13=IFCRELDEFINESBYPROPERTIES('2123456789ABCDEFGHIJKM',$,$,$,(#12),#2);\n"
            'ENDSEC;\nEND-ISO-10303-21;')
        self.paths['source.ifc'].write_text(ifc)
        self.source['ifcAsset']['sha256'] = sha(ifc.encode())
        self.source['ifcAsset']['bytes'] = len(ifc.encode())
        self.semantic_map['ifcOriginalSha256'] = sha(ifc.encode())
        self.save()
        with self.assertRaises(PublicationError): self.run_publish()

    def test_electrical_group_cannot_be_a_floorplan_room(self):
        group_id = uid()
        floor = self.config['floors'][0]
        plan = {'profile':'houseatlas.ifc-floorplan.v1',
                'sourceRevisionId':self.source['revisionId'],
                'sourceIfcSha256':self.source['ifcAsset']['sha256'],
                'semanticMapRevisionId':self.map_id,
                'units':'mm','upAxis':'Z','floor':floor,
                'spaces':[{'entityId':group_id,
                           'ifcGlobalId':'0123456789ABCDEFGHIJKL',
                           'polygons':[[[0,0],[1,0],[0,1]]]}],
                'meshBindings':[]}
        with self.assertRaises(PublicationError):
            check_plan(plan, self.source, self.map_id,
                       {self.entity_id:('0123456789ABCDEFGHIJKL',self.floor_id)},
                       {'floor':floor}, {'meshes':[], 'nodes':[]})

    def add_second_floor(self):
        second_room = uid(); second_floor = uid()
        extra = (
            "#12=IFCSPACE('0123456789ABCDEFGHIJKM',$,'Other room',$,$);\n"
            "#13=IFCPROPERTYSET('1123456789ABCDEFGHIJKN',$,'HouseAtlas_Identity',$,(#14,#15));\n"
            f"#14=IFCPROPERTYSINGLEVALUE('EntityId',$,IFCIDENTIFIER('{second_room}'),$);\n"
            "#15=IFCPROPERTYSINGLEVALUE('SchemaVersion',$,IFCINTEGER(1),$);\n"
            "#16=IFCRELDEFINESBYPROPERTIES('2123456789ABCDEFGHIJKN',$,$,$,(#12),#13);\n"
            "#17=IFCBUILDINGSTOREY('3123456789ABCDEFGHIJKN',$,'Second floor',$,$);\n"
            "#18=IFCPROPERTYSET('1123456789ABCDEFGHIJKP',$,'HouseAtlas_Identity',$,(#19,#20));\n"
            f"#19=IFCPROPERTYSINGLEVALUE('EntityId',$,IFCIDENTIFIER('{second_floor}'),$);\n"
            "#20=IFCPROPERTYSINGLEVALUE('SchemaVersion',$,IFCINTEGER(1),$);\n"
            "#21=IFCRELDEFINESBYPROPERTIES('2123456789ABCDEFGHIJKP',$,$,$,(#17),#18);\n"
            "#22=IFCRELAGGREGATES('3123456789ABCDEFGHIJKP',$,$,$,#17,(#12));\n")
        data = self.paths['source.ifc'].read_text().replace(
            'ENDSEC;\nEND-ISO-10303-21;', extra + 'ENDSEC;\nEND-ISO-10303-21;').encode()
        self.paths['source.ifc'].write_bytes(data)
        self.source['ifcAsset']['sha256'] = sha(data)
        self.source['ifcAsset']['bytes'] = len(data)
        self.semantic_map['ifcOriginalSha256'] = sha(data)
        self.semantic_map['floors'].append({
            'floorId': second_floor,
            'ifcBuildingStoreyGlobalId':'3123456789ABCDEFGHIJKN',
            'atlasPlaceId':None,'displayName':'Second floor'})
        self.semantic_map['rooms'].append({
            'roomId':second_room,'floorId':second_floor,
            'ifcSpaceGlobalId':'0123456789ABCDEFGHIJKM',
            'atlasPlaceId':None,'packagePlace':None,'displayName':'Other room'})
        self.config['floors'].append({
            'floorId':second_floor,
            'ifcBuildingStoreyGlobalId':'3123456789ABCDEFGHIJKN',
            'label':'Second floor','elevationMm':None,'floorToSource':None})
        self.config['floors'].sort(key=lambda floor: floor['floorId'])
        self.save()
        return second_room

    def test_two_floors_share_source_and_map_pins(self):
        second_room = self.add_second_floor()
        row = self.run_publish()
        self.assertEqual(len(row['floors']), 2)
        self.assertEqual(row['validation']['converterRuns'], 4)
        seen = set()
        for floor in row['floors']:
            path = floor['artifacts']['floorplanFeatures']['path']
            plan = json.loads((self.root/'output'/path).read_text())
            self.assertEqual(plan['sourceIfcSha256'], row['sourceIfcSha256'])
            self.assertEqual(plan['semanticMapRevisionId'], row['semanticMapRevisionId'])
            seen.update(space['entityId'] for space in plan['spaces'])
        self.assertEqual(seen, {self.entity_id, second_room})

    def test_partial_multifloor_config_rejected(self):
        self.add_second_floor()
        self.config['floors'].pop()
        self.save()
        with self.assertRaises(PublicationError): self.run_publish()


if __name__ == '__main__':
    unittest.main()
