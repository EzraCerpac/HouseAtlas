/** Documentary identity and placement have deliberately separate owners. */
export interface ElectricityRoomAssociation {
  readonly packagePlaceKey: string;
  readonly packagePlaceUuid: string;
  readonly nativePlaceId: string | null;
  readonly label: string;
  readonly aliases: readonly { readonly label: string; readonly sourceRefs: readonly string[] }[];
  readonly status: 'owner-reported' | 'inferred';
  readonly historicalLabel: string | null;
  readonly relationship: string;
  readonly statement: string | null;
  readonly roomSourceRefs: readonly string[];
  readonly associationSource: {
    readonly evidenceBasis: 'owner-report' | 'inference'; readonly documentId: string;
    readonly ownerStatementId: string | null; readonly receivedViaThreadId: string | null;
  };
}

export interface ElectricityStatement {
  readonly text: string;
  readonly evidenceBasis: 'document' | 'inference';
  readonly uncertainty: { readonly status: string; readonly explanation: string };
}

export interface ElectricitySheet {
  /** Package documentary ID, never a native circuit, outlet or evidence ID. */
  readonly id: string;
  readonly bundleId: string;
  readonly titleAsRead: string;
  readonly source: {
    readonly photo: string; readonly sha256: string; readonly renderedPhoto: string;
    readonly pdfPage: number; readonly factAt: string | null; readonly sourceDate: string | null;
    readonly retrievedAt: string | null; readonly interpretationDate: string;
  };
  readonly documentaryLabels: readonly string[];
  readonly directReading: ElectricityStatement;
  readonly drawingAssociation: ElectricityStatement;
  readonly openUncertainty: string;
  readonly roomAssociations: readonly ElectricityRoomAssociation[];
  readonly spatial: {
    readonly mappingStatus: 'unmatched'; readonly coordinate: null;
    readonly sourceImageRegion: {
      readonly coordinateSpace: 'normalized-upright-photo';
      readonly xyxy: readonly [number, number, number, number];
    };
  };
}

export interface ElectricityOverlayData {
  readonly schema: 'houseatlas.documentary-electricity.v1';
  /** Fresh owner-supplied authorized view identity, containing no credentials. */
  readonly viewKey: string;
  readonly buildingPlaceId: string | null;
  readonly preparationSnapshot: { readonly status: string; readonly nativeImportReceipt: null };
  readonly sheets: readonly ElectricitySheet[];
}

export interface ElectricitySelection { readonly kind: 'electricity-evidence'; readonly id: string }

export interface ElectricityOverlayPanelProps {
  readonly active: boolean;
  readonly viewKey: string;
  readonly data: ElectricityOverlayData | null;
  /** Raw export context only; this is not accepted room or floor membership. */
  readonly selectedFloor?: { readonly id: string; readonly label: string } | null;
  readonly selectedPlaceId?: string | null;
  readonly onSelectionChange?: (selection: ElectricitySelection | null) => void;
  /** Explicit owner action; it must resolve current native file availability. */
  readonly onOpenSource?: (sheetId: string, pdfPage: number) => void;
}
