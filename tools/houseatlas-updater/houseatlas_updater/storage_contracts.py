"""Source-reviewed contract mappings; inert until explicitly supplied by an owner.

The keys bind the exact canonical preimages in ../contracts. This factory does
not select a target or qualify current state, release compatibility or rollback.
It performs no I/O and is not wired into a CLI, controller or default adapter.
"""

from .model import STORAGE_MAPPING_PROTOCOL_V1, Storage


ATLAS_STORAGE_CONTRACT_V2_SHA256 = "b226413460ca7a57ba6fb245c65e415f87814d2e96227024b8a0146ad03bdd2d"
FULL_GEODATA_STORAGE_CONTRACT_V2_SHA256 = "ef8517886be6bb1d6836c01fc3c606f326b53c2d4e604b46031761921e566900"


def trusted_storage_contracts() -> dict[str, Storage]:
    """Return fresh typed values; callers still own explicit native admission."""
    return {
        ATLAS_STORAGE_CONTRACT_V2_SHA256: Storage(
            "houseatlas-persistent-server/1", "houseatlas-server-state/2", 1,
            "atlas", 5, STORAGE_MAPPING_PROTOCOL_V1),
        FULL_GEODATA_STORAGE_CONTRACT_V2_SHA256: Storage(
            "houseatlas-persistent-full-geodata-server/1", "houseatlas-server-state/2", 1,
            "full-geodata", 1, STORAGE_MAPPING_PROTOCOL_V1),
    }
