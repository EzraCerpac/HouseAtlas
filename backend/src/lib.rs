//! Shared Rust baseline. Feature modules are integrated by their owners.

pub mod access;
pub mod ai;
pub mod app;
pub mod config;
pub mod contracts;
pub mod credential_boundary;
pub mod domain;
pub mod http;
pub mod jobs;
pub mod lifecycle;
pub mod media;
pub mod storage;
pub mod transports {
    pub mod mcp;
}
pub mod providers {
    pub mod network;
    pub mod homebox {
        pub mod read;
        pub mod recovery;
        pub mod wire;
        pub mod write;
        pub mod write_transport;
    }
}
