import type { SceneAssociationClient } from '../../../../integration/native-scene-association-client';
import type { NativeEvidenceDocumentClient } from '../native-evidence-document-types';
import type { NativeSceneSourceClient, NativeSceneSourceSelection } from '../native-scene-source-types';

/** Independent retained-document owners; selection is issued by the validated current head. */
export interface NativeSceneHost {
  readonly associations: SceneAssociationClient;
  readonly sources: NativeSceneSourceClient;
  readonly drawings: NativeEvidenceDocumentClient;
  select(selection: NativeSceneSourceSelection): boolean;
  clear(selection: NativeSceneSourceSelection): void;
}
