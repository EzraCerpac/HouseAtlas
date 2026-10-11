# Credential platform source composition

The selected source platform is Linux Secret Service with exact secret-service
5.2.0, ring 0.17.14 and zeroize 1.9.1 dependencies. Default features are disabled;
Secret Service uses rt-tokio-crypto-rust, ring uses alloc/std, and zeroize uses
alloc. The [official release manifest](https://github.com/open-source-cooperative/secret-service-rs/blob/1fe4fbe405b152bc969deb5de417847e1e4e4c7b/Cargo.toml)
defines the selected runtime/crypto feature. The direct native lookup uses the
[Secret Service API](https://docs.rs/secret-service/5.2.0/secret_service/) with DH
transport and checks existing unlocked collections/items. It never invokes an
unlock, prompt, creation or deletion method. Non-Linux returns unavailable.

The composed FileCredentialBoundary authenticates and encrypts the complete
private registration record with AES-256-GCM, a fresh OS-random nonce and original
registration AAD. Its exclusive original-registration lease, private absolute
filesystem, complete-record atomic replacement and original-authority proof
remain mandatory. Native keys are freshly read; missing, locked, ambiguous or
corrupt storage remains unavailable. Successful plaintext/key/scratch buffers
are zeroized on Drop; complete process-memory erasure is not established.

Source composition does not provision keys or credentials, call an OS service,
enroll an initial registration or mount an operational AI host. Original host
proof, stop-use and final epoch fence, first-record trusted enrollment and
genuine runtime/model/catalog adapters remain integration inputs. The core
trusted reconnect transition now persists the captured cancellation binding
under the original lease, after retained credentials/checkpoints are cleared. Default Settings remains unavailable. Owner-side synthetic
key/authority persistence fixtures are separate from composed-root runtime proof;
ordinary source compilation executes none of those credential fixtures.
