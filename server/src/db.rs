#[derive(Debug, Clone)]
pub struct Postgre {
    pub pool: sqlx::PgPool,
}
