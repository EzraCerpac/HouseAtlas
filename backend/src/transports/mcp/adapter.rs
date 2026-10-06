use std::collections::BTreeSet;

use serde_json::Value;

use super::protocol::{self, CallParams, InitializeParams, ListParams, Message, RequestId};
use super::{
    CatalogPort, Implementation, JsonObject, PROTOCOL_VERSION, PortError, PrincipalPort,
    ServicePort, ToolResult,
};

/// Bounds are per embeddable protocol session; host framing/transport bounds,
/// timeouts, origins and deployment authorization remain host responsibilities.
#[derive(Clone, Debug)]
pub struct AdapterConfig {
    pub server_info: Implementation,
    pub max_message_bytes: usize,
    pub max_response_bytes: usize,
    pub max_session_requests: usize,
    pub max_session_id_bytes: usize,
}

impl Default for AdapterConfig {
    fn default() -> Self {
        Self {
            server_info: Implementation {
                name: "HouseAtlas".into(),
                version: "0.1.0".into(),
            },
            max_message_bytes: 64 * 1024,
            max_response_bytes: 1024 * 1024,
            max_session_requests: 4096,
            max_session_id_bytes: 1024 * 1024,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConfigError {
    InvalidBounds,
    ServerInfoTooLarge,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionState {
    New,
    AwaitingInitialized,
    Ready,
    Closed,
}

/// One host connection/session, serialized by `&mut`. Trusted context is fixed
/// at creation and cannot be supplied/replaced by an MCP message. No principal,
/// domain result or grant is cached here. IDs are retained until close to avoid
/// dispatching the same session request twice; the host reconnects at the bound.
pub struct Session<Context> {
    context: Context,
    state: SessionState,
    client_info: Option<Implementation>,
    client_capabilities: Option<JsonObject>,
    request_ids: BTreeSet<RequestId>,
    request_id_bytes: usize,
}

impl<Context> Session<Context> {
    pub fn state(&self) -> SessionState {
        self.state
    }
    pub fn client_info(&self) -> Option<&Implementation> {
        self.client_info.as_ref()
    }
    pub fn client_capabilities(&self) -> Option<&JsonObject> {
        self.client_capabilities.as_ref()
    }

    /// The host calls this when its underlying connection is terminated.
    /// MCP has no shutdown request; this performs no provider/storage work.
    pub fn close(&mut self) {
        self.state = SessionState::Closed;
        self.client_info = None;
        self.client_capabilities = None;
        self.request_ids.clear();
        self.request_id_bytes = 0;
    }
}

pub struct McpAdapter<A, C, S> {
    principal: A,
    catalog: C,
    service: S,
    config: AdapterConfig,
}

impl<A, C, S> McpAdapter<A, C, S>
where
    A: PrincipalPort,
    C: CatalogPort<A::Principal, Requirement = A::Requirement>,
    S: ServicePort<A::Principal, C::Operation, Output = C::Output>,
{
    pub fn new(
        principal: A,
        catalog: C,
        service: S,
        config: AdapterConfig,
    ) -> Result<Self, ConfigError> {
        // Any bounded error including a maximum-size request ID must fit. This
        // also prevents zero/overflowing bounds from creating invalid sessions.
        if config.max_message_bytes == 0
            || config.max_session_requests == 0
            || config.max_session_id_bytes == 0
            || config
                .max_message_bytes
                .checked_add(1024)
                .is_none_or(|minimum| config.max_response_bytes < minimum)
        {
            return Err(ConfigError::InvalidBounds);
        }
        if serde_json::to_string(&config.server_info).map_or(true, |info| {
            info.len()
                .saturating_add(config.max_message_bytes)
                .saturating_add(512)
                > config.max_response_bytes
        }) {
            return Err(ConfigError::ServerInfoTooLarge);
        }
        Ok(Self {
            principal,
            catalog,
            service,
            config,
        })
    }

    pub fn open(&self, context: A::Context) -> Session<A::Context> {
        Session {
            context,
            state: SessionState::New,
            client_info: None,
            client_capabilities: None,
            request_ids: BTreeSet::new(),
            request_id_bytes: 0,
        }
    }

    /// Handle one complete JSON message. The caller owns framing and IO. Returns
    /// no bytes for notifications. Await this to completion before handling the
    /// next message; there are no spawned tasks or in-flight request registry.
    pub async fn handle(&self, session: &mut Session<A::Context>, bytes: &[u8]) -> Option<Vec<u8>> {
        if bytes.len() > self.config.max_message_bytes {
            return Some(self.encode(protocol::error(
                None,
                -32600,
                "MCP message size limit exceeded",
            )));
        }
        let message = match protocol::decode(bytes) {
            Ok(message) => message,
            Err(error) if error.notification => return None,
            Err(error) => {
                return Some(self.encode(protocol::error(
                    error.id.as_ref(),
                    error.code,
                    error.message,
                )));
            }
        };
        let Some(id) = message.id.as_ref() else {
            // Unknown notifications are ignored; request methods with no ID do
            // not dispatch tools. Client capabilities/_meta never grant access.
            if message.method == "notifications/initialized"
                && session.state == SessionState::AwaitingInitialized
            {
                session.state = SessionState::Ready;
            }
            return None;
        };
        if session.state == SessionState::Closed {
            return Some(self.encode(protocol::error(Some(id), -32000, "MCP session is closed")));
        }
        if session.request_ids.contains(id) {
            return Some(self.encode(protocol::error(
                Some(id),
                -32600,
                "MCP request ID already used",
            )));
        }
        let id_bytes = match id {
            RequestId::Text(text) => text.len(),
            RequestId::Integer(_) => 16,
        };
        if session.request_ids.len() >= self.config.max_session_requests
            || id_bytes
                > self
                    .config
                    .max_session_id_bytes
                    .saturating_sub(session.request_id_bytes)
        {
            session.close();
            return Some(self.encode(protocol::error(
                Some(id),
                -32000,
                "MCP session request limit reached; reconnect",
            )));
        }
        session.request_ids.insert(id.clone());
        session.request_id_bytes += id_bytes;
        let response = self.dispatch(session, &message).await;
        Some(self.encode(response))
    }

    async fn dispatch(&self, session: &mut Session<A::Context>, message: &Message) -> Value {
        let id = message.id.as_ref().unwrap();
        let invalid = || protocol::error(Some(id), -32602, "Invalid MCP parameters");
        if message.method == "ping" {
            return protocol::result(id, serde_json::json!({}));
        }
        if message.method == "initialize" {
            if session.state != SessionState::New {
                return protocol::error(Some(id), -32600, "MCP session already initialized");
            }
            let Ok(params) =
                serde_json::from_value::<InitializeParams>(Value::Object(message.params.clone()))
            else {
                return invalid();
            };
            // With one supported revision, an unsupported request negotiates
            // our supported revision. The client decides whether to disconnect.
            let _requested_version = params.protocol_version;
            session.client_info = Some(params.client_info);
            session.client_capabilities = Some(params.capabilities);
            session.state = SessionState::AwaitingInitialized;
            return protocol::result(
                id,
                serde_json::json!({
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {"tools": {}},
                    "serverInfo": self.config.server_info,
                }),
            );
        }
        if session.state != SessionState::Ready {
            return protocol::error(
                Some(id),
                -32000,
                "MCP initialization must complete before tools are used",
            );
        }
        match message.method.as_str() {
            "tools/list" => {
                let Ok(params) =
                    serde_json::from_value::<ListParams>(Value::Object(message.params.clone()))
                else {
                    return invalid();
                };
                self.list(session, id, params.cursor.as_deref()).await
            }
            "tools/call" => {
                // Task-augmented execution is not negotiated or implemented.
                if message.params.contains_key("task") {
                    return invalid();
                }
                let Ok(params) =
                    serde_json::from_value::<CallParams>(Value::Object(message.params.clone()))
                else {
                    return invalid();
                };
                self.call(session, id, params).await
            }
            _ => protocol::error(Some(id), -32601, "MCP method not found"),
        }
    }

    async fn list(
        &self,
        session: &Session<A::Context>,
        id: &RequestId,
        cursor: Option<&str>,
    ) -> Value {
        let principal = match self.principal.resolve(&session.context).await {
            Ok(principal) => principal,
            Err(error) => return port_error(id, error, false),
        };
        let page = match self.catalog.list(&principal, cursor) {
            Ok(page) => page,
            Err(error) => return port_error(id, error, false),
        };
        if let Err(error) = self
            .principal
            .revalidate(&session.context, &principal)
            .await
        {
            return port_error(id, error, false);
        }
        match serde_json::to_value(page) {
            Ok(page) => protocol::result(id, page),
            Err(_) => port_error(id, PortError::Unavailable, false),
        }
    }

    async fn call(
        &self,
        session: &Session<A::Context>,
        id: &RequestId,
        params: CallParams,
    ) -> Value {
        let principal = match self.principal.resolve(&session.context).await {
            Ok(principal) => principal,
            Err(error) => return port_error(id, error, true),
        };
        let prepared = match self
            .catalog
            .prepare(&principal, &params.name, params.arguments)
        {
            Ok(prepared) => prepared,
            Err(error) => {
                if let Err(error) = self
                    .principal
                    .revalidate(&session.context, &principal)
                    .await
                {
                    return port_error(id, error, true);
                }
                return port_error(id, error, true);
            }
        };
        let principal = match self
            .principal
            .authorize(&session.context, &prepared.requirement)
            .await
        {
            Ok(principal) => principal,
            Err(error) => return port_error(id, error, true),
        };
        let output = match self.service.execute(&principal, prepared.operation).await {
            Ok(output) => self.catalog.render(&params.name, output),
            Err(error) => Err(error),
        };
        // Revalidate for successful DTOs and public tool failure results alike.
        if let Err(error) = self
            .principal
            .revalidate(&session.context, &principal)
            .await
        {
            return port_error(id, error, true);
        }
        match output {
            Ok(output) => match serde_json::to_value(output) {
                Ok(output) => protocol::result(id, output),
                Err(_) => port_error(id, PortError::Unavailable, true),
            },
            Err(error) => port_error(id, error, true),
        }
    }

    fn encode(&self, response: Value) -> Vec<u8> {
        let bytes = response.to_string().into_bytes();
        if bytes.len() <= self.config.max_response_bytes {
            return bytes;
        }
        // An exceeded response bound never reruns a possibly committed write.
        // Canonical mutation IDs/receipts remain the service's retry mechanism.
        let mut bounded = protocol::error(None, -32603, "MCP response size limit exceeded");
        if let Some(id) = response.get("id") {
            bounded
                .as_object_mut()
                .unwrap()
                .insert("id".into(), id.clone());
        }
        bounded.to_string().into_bytes()
    }
}

fn port_error(id: &RequestId, error: PortError, tool_call: bool) -> Value {
    match error {
        PortError::Unauthenticated => protocol::error(Some(id), -32001, "Authentication required"),
        PortError::Forbidden => protocol::error(Some(id), -32003, "Request not permitted"),
        PortError::UnknownTool => protocol::error(Some(id), -32602, "Unknown or unavailable tool"),
        PortError::InvalidCursor => {
            protocol::error(Some(id), -32602, "Invalid tool catalog cursor")
        }
        PortError::ToolFailure(failure) if tool_call => {
            match serde_json::to_value(ToolResult::failure(failure)) {
                Ok(result) => protocol::result(id, result),
                Err(_) => protocol::error(Some(id), -32603, "Tool result unavailable"),
            }
        }
        PortError::ToolFailure(_) | PortError::Unavailable => {
            protocol::error(Some(id), -32603, "Service unavailable")
        }
    }
}
