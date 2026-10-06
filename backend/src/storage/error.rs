use std::fmt;

pub type Result<T> = std::result::Result<T, Error>;

/// Sanitized errors suitable for mapping at the service boundary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error {
    pub code: &'static str,
    pub message: &'static str,
}

impl Error {
    pub const fn new(code: &'static str, message: &'static str) -> Self {
        Self { code, message }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for Error {}

impl From<rusqlite::Error> for Error {
    fn from(error: rusqlite::Error) -> Self {
        match error {
            rusqlite::Error::SqliteFailure(ref code, _)
                if code.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                Self::new(
                    "identity-conflict",
                    "Stored identity or manifest is already reserved",
                )
            }
            _ => Self::new("storage-unavailable", "SQLite operation could not complete"),
        }
    }
}
impl From<serde_json::Error> for Error {
    fn from(_: serde_json::Error) -> Self {
        Self::new(
            "schema-incompatible",
            "Stored contract data is incompatible",
        )
    }
}
