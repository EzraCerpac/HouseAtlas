use serde::Serialize;
use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ErrorCode {
    Timeout,
    Auth,
    WrongScope,
    InvalidSchema,
    Pagination,
    SizeLimit,
    Transport,
    Upstream,
}

impl ErrorCode {
    pub fn message(self) -> &'static str {
        match self {
            Self::Timeout => "HomeBox read exceeded its time limit.",
            Self::Auth => "HomeBox access was denied; cached access requires scope revalidation.",
            Self::WrongScope => "HomeBox response does not match the registered source partition.",
            Self::InvalidSchema => "HomeBox metadata failed the pinned synthetic contract.",
            Self::Pagination => {
                "HomeBox pagination did not complete consistently within its limits."
            }
            Self::SizeLimit => "HomeBox read exceeded its byte limit.",
            Self::Transport => "HomeBox read transport failed.",
            Self::Upstream => "HomeBox returned an unsuccessful response.",
        }
    }

    pub fn quarantines(self) -> bool {
        matches!(self, Self::Auth | Self::WrongScope)
    }
}

/// Sanitized by construction: never carries driver messages, response bytes or URLs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReadError(pub ErrorCode);

impl fmt::Display for ReadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.0.message())
    }
}
impl std::error::Error for ReadError {}
pub(super) fn invalid() -> ReadError {
    ReadError(ErrorCode::InvalidSchema)
}
