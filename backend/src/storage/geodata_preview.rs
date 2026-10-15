//! Full-profile single-original PNG proof owner. Fresh profile stays original-only.
use super::*;
impl<D: GeodataConnection, U: GeodataAuthority> GeodataRepository<D, U> {
    pub(super) fn qualify_png(
        &self,
        document: &mut Value,
        original_asset: &Value,
        original_manifest: &mt::AssetPayload,
        original_bytes: &[u8],
        budget: &m::WorkBudget,
    ) -> Result<Option<(Value, mt::AssetPayload, String, String)>> {
        if self.selection != GeodataSelection::Full
            || original_asset["payload"]["contentType"] != "image/png"
        {
            return Ok(None);
        }
        let scope = mt::Scope {
            workspace_id: field(document, "workspaceId")?.into(),
            home_id: field(document, "homeId")?.into(),
        };
        let pin: m::geodata_document::AssetPin =
            serde_json::from_value(document["payload"]["original"].clone())?;
        let output_id = app::new_id()?;
        let qualified = match m::geodata_png_preview::qualify(
            &scope,
            &pin,
            original_asset,
            original_bytes,
            &output_id,
            1,
            budget,
        ) {
            Ok(q) => q,
            Err(m::MediaError::TooLarge | m::MediaError::Unsupported) => {
                budget.check().map_err(media_error)?;
                return Ok(None);
            }
            Err(e) => return Err(media_error(e)),
        };
        budget.check().map_err(media_error)?;
        let mut asset = original_asset.clone();
        asset["recordId"] = json!(output_id);
        asset["lastAuditId"] = json!(app::new_id()?);
        asset["payload"]["purpose"] = json!("preview");
        asset["payload"]["contentType"] = json!(m::geodata_document::PREVIEW_MIME);
        asset["payload"]["sha256"] = json!(qualified.asset().sha256);
        asset["payload"]["bytes"] = json!(qualified.asset().bytes);
        shape("geodataAssetRecord", &asset)?;
        let mut manifest = original_manifest.clone();
        manifest.purpose = mt::AssetPurpose::DerivedPreview;
        manifest.content_type = m::geodata_document::PREVIEW_MIME.into();
        manifest.sha256 = qualified.asset().sha256.clone();
        manifest.byte_size = qualified.asset().bytes;
        manifest.storage_key = scope.storage_key(&manifest.sha256).map_err(media_error)?;
        let media = mt::AssetRecord {
            schema_version: 1,
            record_type: mt::AssetRecordType::Asset,
            record_id: output_id,
            workspace_id: scope.workspace_id.clone(),
            home_id: scope.home_id.clone(),
            revision: 1,
            lifecycle: mt::Lifecycle::Active,
            created_at: field(&asset, "createdAt")?.into(),
            updated_at: field(&asset, "updatedAt")?.into(),
            last_audit_id: field(&asset, "lastAuditId")?.into(),
            payload: manifest.clone(),
        };
        self.vault
            .restore_retained(&media, qualified.bytes(), budget)
            .map_err(media_error)?;
        document["payload"]["preview"] = qualified.lineage().clone();
        Ok(Some((
            asset,
            manifest,
            field(qualified.lineage(), "qualificationReceiptSha256")?.into(),
            qualified.receipt_canonical().into(),
        )))
    }
    pub(super) fn verified_preview(
        &self,
        document: &Value,
        budget: &m::WorkBudget,
    ) -> Result<Option<(Value, Vec<u8>)>> {
        let lineage = &document["payload"]["preview"];
        if lineage.is_null() {
            return Ok(None);
        }
        need(self.selection == GeodataSelection::Full)?;
        let scope = Scope {
            workspace_id: field(document, "workspaceId")?.into(),
            home_id: field(document, "homeId")?.into(),
        };
        let pin = &lineage["asset"];
        let output = self.raw_record(&scope, field(pin, "assetId")?)?;
        shape("geodataAssetRecord", &output)?;
        let original = self.original(document)?;
        need(
            output["workspaceId"] == document["workspaceId"]
                && output["homeId"] == document["homeId"]
                && output["recordType"] == "asset"
                && output["revision"] == pin["revision"]
                && output["lifecycle"] == "active"
                && output["payload"]["purpose"] == "preview"
                && output["payload"]["contentType"] == m::geodata_document::PREVIEW_MIME
                && output["payload"]["availability"] == "available"
                && output["payload"]["sourceLicense"] == original["payload"]["sourceLicense"]
                && output["payload"]["sha256"] == pin["sha256"]
                && output["payload"]["bytes"] == pin["bytes"],
        )?;
        let digest = field(lineage, "qualificationReceiptSha256")?;
        let (kind, w, h, body) = self.db.connection().query_row(
            "SELECT kind,workspace_id,home_id,body FROM geodata_receipts WHERE sha256=?1",
            [digest],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            },
        )?;
        need(
            kind == "derivation"
                && w == scope.workspace_id
                && h == scope.home_id
                && hash(&body) == digest,
        )?;
        let bytes = self
            .vault
            .read_retained(&self.asset_media(&output)?, budget)
            .map_err(media_error)?;
        let original_bytes = self
            .vault
            .read_retained(&self.asset_media(&original)?, budget)
            .map_err(media_error)?;
        let pin = serde_json::from_value(document["payload"]["original"].clone())?;
        let ms = mt::Scope {
            workspace_id: scope.workspace_id,
            home_id: scope.home_id,
        };
        m::geodata_png_preview::verify_retained(
            &ms,
            &pin,
            &original,
            &original_bytes,
            &bytes,
            lineage,
            body.as_bytes(),
            budget,
        )
        .map_err(media_error)?;
        Ok(Some((output, bytes)))
    }
    pub fn read_preview(
        &self,
        principal: &a::Principal,
        scope: &Scope,
        id: &str,
        expected_revision: u64,
        budget: &m::WorkBudget,
    ) -> Result<(Value, Vec<u8>)> {
        let authority = self.authority.clone();
        let mut result = None;
        authority.read(principal,|guard|->Result<()> {
            Self::authorize(guard,scope,false)?;let d=self.raw_record(scope,id)?;
            if d["revision"]!=expected_revision{return Err(Error::new("revision-conflict","Document revision changed"));}
            need(d["recordType"]=="geodata-document" && d["lifecycle"]=="active")?;self.policy.authorize(guard,&d,false)?;
            let original=self.original(&d)?;need(original["lifecycle"]=="active" && original["payload"]["availability"]=="available")?;
            let (output,bytes)=self.verified_preview(&d,budget)?.ok_or(Error::new("not-found","Preview not qualified"))?;
            need(self.raw_record(scope,id)?==d && self.raw_record(scope,field(&output,"recordId")?)?==output && self.original(&d)?==original)?;
            self.policy.authorize(guard,&d,false)?;Self::authorize(guard,scope,false)?;budget.check().map_err(media_error)?;
            let frame=json!({"profile":"houseatlas.geodata-document-bytes.v2","scope":scope_value(scope),"documentId":id,"documentRevision":expected_revision,"mode":"preview","asset":d["payload"]["preview"]["asset"],"measuredContentType":"image/png"});shape("geodataDocumentPreviewByteFrame",&frame)?;
            result=Some((frame,bytes));Ok(())
        })?;
        result.ok_or_else(invalid)
    }
}
pub(super) fn required_guards(before: Option<&Value>, d: &Value) -> Value {
    let mut pins = vec![d["payload"]["original"].clone()];
    for document in before.into_iter().chain(std::iter::once(d)) {
        if !document["payload"]["preview"].is_null() {
            let pin = document["payload"]["preview"]["asset"].clone();
            if !pins
                .iter()
                .any(|p| p["assetId"] == pin["assetId"] && p["revision"] == pin["revision"])
            {
                pins.push(pin);
            }
        }
    }
    Value::Array(pins.into_iter().map(|p|json!({"record":{"recordType":"asset","recordId":p["assetId"]},"expectedRevision":p["revision"]})).collect())
}
