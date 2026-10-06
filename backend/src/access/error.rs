use std::fmt;

pub type AccessResult<T> = Result<T, AccessError>;

/// Sanitized boundary failures. Storage/credential details never enter this error.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AccessError {
    Unauthenticated,
    Forbidden,
    NotFound,
    InvalidInput,
    MethodNotAllowed,
    BodyTooLarge,
    RateLimited,
    Unavailable,
}

impl AccessError {
    pub fn status(self) -> u16 {
        match self {
            Self::Unauthenticated => 401,
            Self::Forbidden => 403,
            Self::NotFound => 404,
            Self::InvalidInput => 422,
            Self::MethodNotAllowed => 405,
            Self::BodyTooLarge => 413,
            Self::RateLimited => 429,
            Self::Unavailable => 503,
        }
    }

    /// Existing frozen apiError code; transport adds requestId/currentRevision.
    pub fn code(self) -> &'static str {
        match self {
            Self::Unauthenticated => "unauthenticated",
            Self::Forbidden | Self::RateLimited => "forbidden",
            Self::NotFound => "not-found",
            Self::InvalidInput | Self::MethodNotAllowed | Self::BodyTooLarge => "invalid-contract",
            Self::Unavailable => "upstream-unavailable",
        }
    }
}

impl fmt::Display for AccessError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self.code() {
            "unauthenticated" => "Authentication required",
            "forbidden" => "Request denied",
            "not-found" => "Resource unavailable",
            "invalid-contract" => "Invalid request",
            _ => "Service unavailable",
        })
    }
}

impl std::error::Error for AccessError {}

impl From<rusqlite::Error> for AccessError {
    fn from(_: rusqlite::Error) -> Self {
        Self::Unavailable
    }
}
