use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct MachinePortConfig {
    pub mode: MachineProtocol,
    pub serial_path: Option<String>,
    pub baud_rate: Option<u32>,
    pub tcp_host: Option<String>,
    pub tcp_port: Option<u16>,
    pub unit_id: u8,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MachineProtocol {
    ModbusRtu,
    ModbusTcp,
    Serial,
}

#[derive(Debug, Clone, Serialize)]
pub struct MachineReading {
    pub shelf_temp_c: f64,
    pub product_temp_c: f64,
    pub condenser_temp_c: f64,
    pub chamber_pressure_mbar: f64,
    pub phase: String,
}

#[allow(dead_code)]
pub async fn read_machine_once(_config: &MachinePortConfig) -> anyhow::Result<MachineReading> {
    // The first hardware adapter belongs here. Keep register maps isolated from
    // API/storage code so device-specific changes do not leak across the app.
    anyhow::bail!("machine adapter is not configured yet")
}
