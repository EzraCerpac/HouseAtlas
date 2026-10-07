#[path = "queue-check.rs"]
mod queue_check;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    queue_check::run(false)
}
