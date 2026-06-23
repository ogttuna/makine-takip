use std::net::SocketAddr;

use anyhow::Context;

#[derive(Debug, Clone)]
pub struct CollectorConfig {
    pub bind_addr: SocketAddr,
    pub database_url: String,
}

impl CollectorConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let bind_addr = std::env::var("FREEZEDRY_BIND_ADDR")
            .unwrap_or_else(|_| "127.0.0.1:4777".to_string())
            .parse()
            .context("FREEZEDRY_BIND_ADDR must be a socket address")?;
        let database_url = std::env::var("FREEZEDRY_DB_URL")
            .unwrap_or_else(|_| "sqlite://data/freezedry.db".to_string());

        Ok(Self {
            bind_addr,
            database_url,
        })
    }
}
