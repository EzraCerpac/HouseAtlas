//! Exact stock mapper route/method/body envelope, not authorization or schemas.
use super::{TransportFault, stock::*};
use uuid::Uuid;

pub(super) fn check(plan: &NativePlan) -> Result<(), TransportFault> {
    let r = &plan.request;
    if r.path.len() > 4096 {
        return Err(TransportFault::Route);
    }
    let path: Vec<_> = r.path.split('/').collect();
    if path.get(..3) != Some(&["", "api", "v1"][..]) {
        return Err(TransportFault::Route);
    }
    let json = matches!(&r.body, NativeBody::Json(v) if v.is_object());
    let none = matches!(r.body, NativeBody::None);
    let id = |s: &str| Uuid::parse_str(s).is_ok_and(|id| !id.is_nil() && id.to_string() == s);
    let (valid, response) = match &path[3..] {
        ["entities"] => (r.method == NativeMethod::Post && json, ResponseKind::Entity),
        ["entities", "import"] => (
            r.method == NativeMethod::Post
                && matches!(&r.body,
            NativeBody::Multipart { file_field, stage, fields } if file_field == "csv"
                && stage.content_type == "text/csv" && fields.is_empty()),
            ResponseKind::NoContent,
        ),
        ["entities", owner, "attachments"] if id(owner) => (
            r.method == NativeMethod::Post
                && matches!(&r.body, NativeBody::Multipart { file_field, stage, fields }
                if file_field == "file" && fields.len() == 3
                    && fields[0] == ("name".into(), stage.filename.clone())
                    && fields[1].0 == "type" && ["photo", "manual", "warranty", "attachment", "receipt", "thumbnail"].contains(&fields[1].1.as_str())
                    && fields[2].0 == "primary" && ["true", "false"].contains(&fields[2].1.as_str())),
            ResponseKind::Entity,
        ),
        ["entities", owner, "attachments", "external"] if id(owner) => {
            (r.method == NativeMethod::Post && json, ResponseKind::Entity)
        }
        ["entities", owner, "attachments", attachment] if id(owner) && id(attachment) => (
            (r.method == NativeMethod::Put && json) || (r.method == NativeMethod::Delete && none),
            if r.method == NativeMethod::Delete {
                ResponseKind::NoContent
            } else {
                ResponseKind::Entity
            },
        ),
        ["entities", owner, "maintenance"] if id(owner) => (
            r.method == NativeMethod::Post && json,
            ResponseKind::Maintenance,
        ),
        ["entities", entity, "duplicate"] if id(entity) => {
            (r.method == NativeMethod::Post && json, ResponseKind::Entity)
        }
        ["entities", entity] if id(entity) => (
            (matches!(r.method, NativeMethod::Put | NativeMethod::Patch) && json)
                || (r.method == NativeMethod::Delete && none),
            if r.method == NativeMethod::Delete {
                ResponseKind::NoContent
            } else {
                ResponseKind::Entity
            },
        ),
        [kind @ ("tags" | "entity-types" | "templates")] => {
            (r.method == NativeMethod::Post && json, resource(kind))
        }
        [
            kind @ ("tags" | "entity-types" | "templates" | "maintenance"),
            target,
        ] if id(target) => (
            (r.method == NativeMethod::Put && json) || (r.method == NativeMethod::Delete && none),
            if r.method == NativeMethod::Delete {
                ResponseKind::NoContent
            } else {
                resource(kind)
            },
        ),
        ["templates", template, "create-item"] if id(template) => {
            (r.method == NativeMethod::Post && json, ResponseKind::Entity)
        }
        ["actions", "wipe-inventory"] => {
            (r.method == NativeMethod::Post && json, ResponseKind::Bulk)
        }
        ["actions", action]
            if [
                "create-missing-thumbnails",
                "ensure-asset-ids",
                "ensure-import-refs",
                "set-primary-photos",
                "zero-item-time-fields",
            ]
            .contains(action) =>
        {
            (r.method == NativeMethod::Post && none, ResponseKind::Bulk)
        }
        [
            "labelmaker",
            subject @ ("asset" | "item" | "location"),
            target,
        ] if (subject == &"asset"
            && !target.is_empty()
            && target.bytes().all(|b| b.is_ascii_digit()))
            || (subject != &"asset" && id(target)) =>
        {
            (r.method == NativeMethod::Get && none, ResponseKind::Printer)
        }
        _ => return Err(TransportFault::Route),
    };
    let query_ok = if response == ResponseKind::Printer {
        r.query == [("print".into(), "true".into())]
            && plan.max_response_bytes.is_some_and(|n| n > 0)
    } else {
        r.query.is_empty()
    };
    let success_status = if response == ResponseKind::NoContent {
        204
    } else if r.method == NativeMethod::Post && response != ResponseKind::Bulk {
        201
    } else {
        200
    };
    if !valid || !query_ok || plan.response != response || plan.success_status != success_status {
        return Err(TransportFault::Route);
    }
    Ok(())
}
fn resource(kind: &str) -> ResponseKind {
    match kind {
        "tags" => ResponseKind::Tag,
        "entity-types" => ResponseKind::EntityType,
        "maintenance" => ResponseKind::Maintenance,
        _ => ResponseKind::Template,
    }
}
