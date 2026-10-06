//! A scoped compiler/dependency example, not an application router or storage module.
//! Requests stay in memory and SQLite is disposable. This opens no listener.

use std::error::Error;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
    routing::get,
};
use rusqlite::{Connection, params};
use tower::ServiceExt;

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn Error>> {
    let mut connection = Connection::open_in_memory()?;
    connection
        .execute_batch("CREATE TABLE example (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")?;
    let transaction = connection.transaction()?;
    transaction.execute(
        "INSERT INTO example (id, value) VALUES (?1, ?2)",
        params![1, "synthetic-baseline"],
    )?;
    transaction.commit()?;
    let stored: String = connection.query_row(
        "SELECT value FROM example WHERE id = ?1",
        params![1],
        |row| row.get(0),
    )?;
    assert_eq!(stored, "synthetic-baseline");

    // Exercise the selected Axum/Tower/Tokio combination without a network socket.
    let application = Router::new().route("/", get(|| async { "synthetic-baseline" }));
    let response = application
        .oneshot(Request::builder().uri("/").body(Body::empty())?)
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        to_bytes(response.into_body(), 128).await?.as_ref(),
        stored.as_bytes(),
    );
    println!(
        "PASS healthy dependency source example: SQLite {} transaction and in-memory Axum request",
        rusqlite::version(),
    );
    Ok(())
}
