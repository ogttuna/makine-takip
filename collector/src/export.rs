use std::borrow::Cow;
use std::collections::BTreeMap;

use anyhow::{Context, bail};
use chrono::{Duration, NaiveDateTime, Utc};
use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, Workbook};
use sqlx::{FromRow, SqlitePool};

const STORED_TIMESTAMP_FORMAT: &str = "%Y-%m-%dT%H:%M:%S%.3f";
const FILE_TIMESTAMP_FORMAT: &str = "%Y%m%d_%H%M";
const MAX_EXPORT_RANGE_HOURS: i64 = 120;
const CSV_CONTENT_TYPE: &str = "text/csv; charset=utf-8";
const XLSX_CONTENT_TYPE: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    Csv,
    Xlsx,
}

impl ExportFormat {
    fn extension(self) -> &'static str {
        match self {
            Self::Csv => "csv",
            Self::Xlsx => "xlsx",
        }
    }

    fn content_type(self) -> &'static str {
        match self {
            Self::Csv => CSV_CONTENT_TYPE,
            Self::Xlsx => XLSX_CONTENT_TYPE,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ExportRange {
    from: NaiveDateTime,
    to: NaiveDateTime,
    from_text: String,
    to_text: String,
}

impl ExportRange {
    pub fn parse(from: &str, to: &str) -> anyhow::Result<Self> {
        let from_value = parse_timestamp(from, "export start")?;
        let to_value = parse_timestamp(to, "export end")?;

        if from_value > to_value {
            bail!("export start must not be after export end");
        }

        if to_value - from_value > Duration::hours(MAX_EXPORT_RANGE_HOURS) {
            bail!("export range must not exceed {MAX_EXPORT_RANGE_HOURS} hours");
        }

        Ok(Self {
            from: from_value,
            to: to_value,
            from_text: from_value.format(STORED_TIMESTAMP_FORMAT).to_string(),
            to_text: to_value.format(STORED_TIMESTAMP_FORMAT).to_string(),
        })
    }

    fn start_bound_text(&self) -> &str {
        &self.from_text
    }

    fn end_bound_text(&self) -> &str {
        &self.to_text
    }
}

#[derive(Debug)]
pub struct GeneratedExport {
    pub bytes: Vec<u8>,
    pub content_type: &'static str,
    pub file_name: String,
    pub row_count: usize,
}

#[derive(Debug, FromRow)]
struct ExportMachine {
    code: String,
    name: String,
}

#[derive(Debug, FromRow)]
struct ExportMeasurementRow {
    frame_id: i64,
    sampled_at: String,
    channel_id: i64,
    channel_code: String,
    raw_text: String,
    numeric_value: Option<f64>,
}

#[derive(Debug)]
struct ExportValue {
    raw_text: String,
    numeric_value: Option<f64>,
}

#[derive(Debug)]
struct ExportFrame {
    id: i64,
    sampled_at: NaiveDateTime,
    values: BTreeMap<i64, ExportValue>,
}

#[derive(Debug)]
pub struct MachineExportData {
    machine: ExportMachine,
    range: ExportRange,
    channels: BTreeMap<i64, String>,
    frames: Vec<ExportFrame>,
}

impl MachineExportData {
    pub fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }

    pub fn row_count(&self) -> usize {
        self.frames.len()
    }
}

pub async fn load_machine_export_data(
    pool: &SqlitePool,
    machine_id: i64,
    range: ExportRange,
) -> anyhow::Result<Option<MachineExportData>> {
    let machine =
        sqlx::query_as::<_, ExportMachine>("SELECT code, name FROM machines WHERE id = ?1")
            .bind(machine_id)
            .fetch_optional(pool)
            .await?;

    let Some(machine) = machine else {
        return Ok(None);
    };

    let rows = sqlx::query_as::<_, ExportMeasurementRow>(
        r#"
        WITH run_source_recency AS (
            SELECT
                bf.run_id,
                MAX(bs.last_seen_at) AS source_last_seen_at
            FROM browser_tail_files bf
            JOIN browser_tail_sources bs ON bs.source_id = bf.source_id
            GROUP BY bf.run_id
        ),
        ranked_frames AS (
            SELECT
                f.id AS frame_id,
                f.sampled_at,
                ROW_NUMBER() OVER (
                    PARTITION BY f.sampled_at
                    ORDER BY
                        CASE WHEN rs.source_last_seen_at IS NULL THEN 1 ELSE 0 END ASC,
                        rs.source_last_seen_at DESC,
                        r.created_at DESC,
                        r.id DESC,
                        f.id DESC
                ) AS export_rank
            FROM sample_frames f
            JOIN runs r ON r.id = f.run_id
            LEFT JOIN run_source_recency rs ON rs.run_id = r.id
            WHERE
                r.machine_id = ?1
                AND f.sampled_at >= ?2
                AND f.sampled_at <= ?3
        )
        SELECT
            rf.frame_id,
            rf.sampled_at,
            c.id AS channel_id,
            c.code AS channel_code,
            m.raw_text,
            m.numeric_value
        FROM ranked_frames rf
        JOIN measurements m ON m.frame_id = rf.frame_id
        JOIN channels c ON c.id = m.channel_id
        WHERE rf.export_rank = 1
        ORDER BY rf.sampled_at ASC, rf.frame_id ASC, c.id ASC
        "#,
    )
    .bind(machine_id)
    .bind(range.start_bound_text())
    .bind(range.end_bound_text())
    .fetch_all(pool)
    .await?;

    let mut channels = BTreeMap::new();
    let mut frames = Vec::<ExportFrame>::new();

    for row in rows {
        channels.entry(row.channel_id).or_insert(row.channel_code);

        let needs_frame = frames.last().is_none_or(|frame| frame.id != row.frame_id);
        if needs_frame {
            let sampled_at =
                NaiveDateTime::parse_from_str(&row.sampled_at, STORED_TIMESTAMP_FORMAT)
                    .with_context(|| {
                        format!("invalid stored sample timestamp `{}`", row.sampled_at)
                    })?;
            frames.push(ExportFrame {
                id: row.frame_id,
                sampled_at,
                values: BTreeMap::new(),
            });
        }

        let frame = frames.last_mut().context("export frame grouping failed")?;
        frame.values.insert(
            row.channel_id,
            ExportValue {
                raw_text: row.raw_text,
                numeric_value: row.numeric_value,
            },
        );
    }

    Ok(Some(MachineExportData {
        machine,
        range,
        channels,
        frames,
    }))
}

pub fn generate_export(
    data: &MachineExportData,
    format: ExportFormat,
) -> anyhow::Result<GeneratedExport> {
    let bytes = match format {
        ExportFormat::Csv => render_csv(data)?,
        ExportFormat::Xlsx => render_xlsx(data)?,
    };
    let file_name = export_file_name(data, format);

    Ok(GeneratedExport {
        bytes,
        content_type: format.content_type(),
        file_name,
        row_count: data.row_count(),
    })
}

fn render_csv(data: &MachineExportData) -> anyhow::Result<Vec<u8>> {
    let estimated_columns = data.channels.len() + 3;
    let mut output = Vec::with_capacity(data.frames.len() * estimated_columns * 12);
    output.extend_from_slice(&[0xEF, 0xBB, 0xBF]);

    let mut writer = csv::WriterBuilder::new()
        .delimiter(b';')
        .from_writer(output);
    let mut header = Vec::with_capacity(estimated_columns);
    header.extend(["MAKINE KODU", "MAKINE ADI", "TARIH SAAT"].map(str::to_string));
    header.extend(
        data.channels
            .values()
            .map(|value| csv_text_cell(value).into_owned()),
    );
    writer.write_record(header)?;

    for frame in &data.frames {
        let mut row = Vec::with_capacity(estimated_columns);
        row.push(csv_text_cell(&data.machine.code).into_owned());
        row.push(csv_text_cell(&data.machine.name).into_owned());
        row.push(frame.sampled_at.format(STORED_TIMESTAMP_FORMAT).to_string());

        for channel_id in data.channels.keys() {
            let value = frame
                .values
                .get(channel_id)
                .map(csv_cell_value)
                .unwrap_or_default();
            row.push(value.into_owned());
        }

        writer.write_record(row)?;
    }

    Ok(writer.into_inner()?)
}

fn csv_cell_value(value: &ExportValue) -> Cow<'_, str> {
    if value.numeric_value.is_some() {
        return Cow::Borrowed(&value.raw_text);
    }

    csv_text_cell(&value.raw_text)
}

fn csv_text_cell(value: &str) -> Cow<'_, str> {
    let first = value.trim_start().chars().next();
    if first.is_some_and(|character| matches!(character, '=' | '+' | '-' | '@')) {
        return Cow::Owned(format!("'{value}"));
    }

    Cow::Borrowed(value)
}

fn render_xlsx(data: &MachineExportData) -> anyhow::Result<Vec<u8>> {
    let mut workbook = Workbook::new();
    let header_format = Format::new()
        .set_bold()
        .set_font_color(Color::RGB(0xF7F8F6))
        .set_background_color(Color::RGB(0x26313A))
        .set_border(FormatBorder::Thin)
        .set_border_color(Color::RGB(0x58636D))
        .set_align(FormatAlign::Center)
        .set_align(FormatAlign::VerticalCenter);
    let timestamp_format = Format::new()
        .set_num_format("dd.mm.yyyy hh:mm:ss")
        .set_align(FormatAlign::Center);
    let decimal_format = Format::new().set_num_format("0.############");
    let label_format = Format::new()
        .set_bold()
        .set_font_color(Color::RGB(0x9B4A1D));
    let title_format = Format::new()
        .set_bold()
        .set_font_size(18)
        .set_font_color(Color::RGB(0x26313A));

    {
        let worksheet = workbook.add_worksheet();
        worksheet.set_name("Veriler")?;
        worksheet.set_tab_color(Color::RGB(0xC7682C));
        worksheet.set_freeze_panes(1, 0)?;
        worksheet.set_row_height(0, 24)?;
        worksheet.set_column_width(0, 15)?;
        worksheet.set_column_width(1, 22)?;
        worksheet.set_column_width(2, 22)?;

        let headers = ["MAKINE KODU", "MAKINE ADI", "TARIH SAAT"];
        for (column, value) in headers.iter().enumerate() {
            worksheet.write_string_with_format(0, column as u16, *value, &header_format)?;
        }
        for (offset, code) in data.channels.values().enumerate() {
            let column = (offset + headers.len()) as u16;
            worksheet.write_string_with_format(0, column, code, &header_format)?;
            worksheet.set_column_width(column, 14)?;
        }

        for (offset, frame) in data.frames.iter().enumerate() {
            let row = (offset + 1) as u32;
            worksheet.write_string(row, 0, &data.machine.code)?;
            worksheet.write_string(row, 1, &data.machine.name)?;
            worksheet.write_datetime_with_format(row, 2, frame.sampled_at, &timestamp_format)?;

            for (channel_offset, channel_id) in data.channels.keys().enumerate() {
                let column = (channel_offset + headers.len()) as u16;
                let Some(value) = frame.values.get(channel_id) else {
                    continue;
                };

                if let Some(number) = value.numeric_value {
                    worksheet.write_number_with_format(row, column, number, &decimal_format)?;
                } else {
                    worksheet.write_string(row, column, &value.raw_text)?;
                }
            }
        }

        let last_row = data.frames.len() as u32;
        let last_column = (estimated_export_column_count(data) - 1) as u16;
        worksheet.autofilter(0, 0, last_row, last_column)?;
    }

    {
        let worksheet = workbook.add_worksheet();
        worksheet.set_name("Bilgi")?;
        worksheet.set_tab_color(Color::RGB(0x26313A));
        worksheet.set_column_width(0, 20)?;
        worksheet.set_column_width(1, 30)?;
        worksheet.write_string_with_format(0, 0, "Makine Veri Dışa Aktarımı", &title_format)?;

        let generated_at = Utc::now().naive_utc() + Duration::hours(3);
        let metadata = [
            ("Makine", data.machine.name.as_str()),
            ("Makine kodu", data.machine.code.as_str()),
            ("Zaman dilimi", "Europe/Istanbul"),
            ("Kayıt sayısı", ""),
        ];

        for (offset, (label, value)) in metadata.iter().enumerate() {
            let row = (offset + 2) as u32;
            worksheet.write_string_with_format(row, 0, *label, &label_format)?;
            if *label == "Kayıt sayısı" {
                worksheet.write_number(row, 1, data.frames.len() as f64)?;
            } else {
                worksheet.write_string(row, 1, *value)?;
            }
        }

        let time_rows = [
            (7, "Başlangıç", data.range.from),
            (8, "Bitiş", data.range.to),
            (9, "Oluşturulma", generated_at),
        ];
        for (row, label, value) in time_rows {
            worksheet.write_string_with_format(row, 0, label, &label_format)?;
            worksheet.write_datetime_with_format(row, 1, value, &timestamp_format)?;
        }
    }

    Ok(workbook.save_to_buffer()?)
}

fn estimated_export_column_count(data: &MachineExportData) -> usize {
    data.channels.len() + 3
}

fn export_file_name(data: &MachineExportData, format: ExportFormat) -> String {
    let machine_code = safe_file_stem(&data.machine.code);
    let from = data.range.from.format(FILE_TIMESTAMP_FORMAT);
    let to = data.range.to.format(FILE_TIMESTAMP_FORMAT);
    format!("{machine_code}_{from}_{to}.{}", format.extension())
}

fn safe_file_stem(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn parse_timestamp(value: &str, label: &str) -> anyhow::Result<NaiveDateTime> {
    NaiveDateTime::parse_from_str(value, STORED_TIMESTAMP_FORMAT)
        .with_context(|| format!("{label} must use yyyy-MM-ddTHH:mm:ss.SSS machine-local time"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fleet::{CreateMachineRequest, create_machine, list_machines};
    use crate::ingest::{
        AppendMeasurementRequest, AppendSampleRequest, AppendSamplesRequest, CreateRunRequest,
        append_samples, create_run,
    };

    #[test]
    fn accepts_exactly_five_days_and_rejects_longer_ranges() {
        assert!(ExportRange::parse("2026-09-10T08:00:00.000", "2026-09-15T08:00:00.000").is_ok());
        let error =
            ExportRange::parse("2026-09-10T08:00:00.000", "2026-09-15T08:00:00.001").unwrap_err();
        assert!(error.to_string().contains("120 hours"));
    }

    #[test]
    fn rejects_reversed_and_timezone_bearing_ranges() {
        assert!(ExportRange::parse("2026-09-15T08:00:00.000", "2026-09-10T08:00:00.000").is_err());
        assert!(
            ExportRange::parse("2026-09-10T08:00:00+03:00", "2026-09-10T09:00:00+03:00").is_err()
        );
    }

    #[test]
    fn neutralizes_spreadsheet_formulas_in_csv_text_cells() {
        assert_eq!(csv_text_cell("=2+2"), "'=2+2");
        assert_eq!(csv_text_cell("  @SUM(A1:A2)"), "'  @SUM(A1:A2)");
        assert_eq!(csv_text_cell("Makine 1"), "Makine 1");
    }

    #[tokio::test]
    async fn scopes_to_machine_and_prefers_the_latest_overlapping_run() {
        let pool = create_test_pool().await;
        let first_machine = list_machines(&pool).await.unwrap().remove(0);
        let second_machine = create_machine(
            &pool,
            CreateMachineRequest {
                code: "FD750-02".to_string(),
                name: "Makine 2".to_string(),
                model: Some("FD-750".to_string()),
                location: None,
            },
        )
        .await
        .unwrap();

        let first_run = test_run(&pool, first_machine.id, "old").await;
        append_test_sample(&pool, first_run, 1, 10.0).await;
        let preferred_run = test_run(&pool, first_machine.id, "preferred").await;
        append_test_sample(&pool, preferred_run, 1, 20.0).await;
        let other_machine_run = test_run(&pool, second_machine.id, "other-machine").await;
        append_test_sample(&pool, other_machine_run, 1, 99.0).await;

        let range =
            ExportRange::parse("2026-09-14T10:00:00.000", "2026-09-14T11:00:00.000").unwrap();
        let data = load_machine_export_data(&pool, first_machine.id, range)
            .await
            .unwrap()
            .unwrap();

        assert_eq!(data.frames.len(), 1);
        assert_eq!(data.frames[0].values[&1].numeric_value, Some(20.0));

        let csv = generate_export(&data, ExportFormat::Csv).unwrap();
        let csv_text = String::from_utf8(csv.bytes[3..].to_vec()).unwrap();
        assert!(csv_text.contains("FD750-01;Makine 1;2026-09-14T10:30:00.000;20"));
        assert!(!csv_text.contains(";99"));

        let xlsx = generate_export(&data, ExportFormat::Xlsx).unwrap();
        assert!(xlsx.bytes.starts_with(b"PK"));
        assert_eq!(xlsx.row_count, 1);
    }

    async fn test_run(pool: &SqlitePool, machine_id: i64, name: &str) -> i64 {
        create_run(
            pool,
            CreateRunRequest {
                name: name.to_string(),
                machine_id: Some(machine_id),
                source_kind: "live".to_string(),
                source_name: Some(name.to_string()),
                started_at: None,
                notes: None,
            },
        )
        .await
        .unwrap()
    }

    async fn append_test_sample(pool: &SqlitePool, run_id: i64, sequence: i64, value: f64) {
        append_samples(
            pool,
            run_id,
            AppendSamplesRequest {
                samples: vec![AppendSampleRequest {
                    sampled_at: "2026-09-14T10:30:00.000".to_string(),
                    source_timestamp_text: None,
                    source_sequence: Some(sequence),
                    state_observation: None,
                    measurements: vec![AppendMeasurementRequest {
                        channel_code: "RAF1".to_string(),
                        raw_text: Some(value.to_string()),
                        numeric_value: Some(value),
                        value_text: None,
                        value_type: None,
                        quality: None,
                        quality_reason: None,
                    }],
                }],
            },
        )
        .await
        .unwrap();
    }

    async fn create_test_pool() -> SqlitePool {
        let temp_dir = tempfile::tempdir().unwrap();
        let database_path = temp_dir.path().join("export.db");
        let database_url = format!("sqlite://{}", database_path.display());
        let pool = crate::db::connect_database(&database_url).await.unwrap();
        std::mem::forget(temp_dir);
        pool
    }
}
