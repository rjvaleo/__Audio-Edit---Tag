//! Tab-separated storage.
//!
//! The index stays TSV rather than moving to a database: the format is already
//! proven at 75,000 rows, it is append-only which is what makes a scan
//! resumable after a crash, and the user can open it in any spreadsheet. A
//! database would add a C dependency and break the single cross-compiled binary.

use std::io::{self, BufRead, BufReader, Write};

/// Strip the characters that would corrupt a row.
///
/// Filenames in this archive genuinely contain tabs and newlines, so this is
/// not defensive programming — it is load-bearing.
pub fn escape(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '\t' | '\n' | '\r' => ' ',
            other => other,
        })
        .collect()
}

pub struct Writer<W: Write> {
    out: W,
    columns: usize,
}

impl<W: Write> Writer<W> {
    /// Start a new file by writing the header row.
    pub fn new(mut out: W, header: &[&str]) -> io::Result<Self> {
        writeln!(out, "{}", header.join("\t"))?;
        Ok(Self {
            out,
            columns: header.len(),
        })
    }

    /// Continue an existing file, trusting that its header is already present.
    pub fn appending(out: W, columns: usize) -> Self {
        Self { out, columns }
    }

    pub fn row(&mut self, fields: &[String]) -> io::Result<()> {
        debug_assert_eq!(
            fields.len(),
            self.columns,
            "row has {} fields but the header declared {}",
            fields.len(),
            self.columns
        );
        let escaped: Vec<String> = fields.iter().map(|f| escape(f)).collect();
        writeln!(self.out, "{}", escaped.join("\t"))
    }

    pub fn flush(&mut self) -> io::Result<()> {
        self.out.flush()
    }
}

/// A parsed TSV file: a header plus rows, addressed by column name.
pub struct Table {
    pub header: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

impl Table {
    pub fn read(r: impl io::Read) -> io::Result<Self> {
        let mut lines = BufReader::new(r).lines();
        let header: Vec<String> = match lines.next() {
            Some(Ok(l)) => l.split('\t').map(|s| s.to_string()).collect(),
            Some(Err(e)) => return Err(e),
            None => return Ok(Table { header: Vec::new(), rows: Vec::new() }),
        };
        let width = header.len();
        let mut rows = Vec::new();
        for line in lines {
            let line = line?;
            if line.is_empty() {
                continue;
            }
            let mut fields: Vec<String> = line.split('\t').map(|s| s.to_string()).collect();
            // A row truncated by an interrupted scan is padded rather than
            // dropped, so a resumed run still sees what was written.
            fields.resize(width, String::new());
            rows.push(fields);
        }
        Ok(Table { header, rows })
    }

    pub fn column(&self, name: &str) -> Option<usize> {
        self.header.iter().position(|h| h == name)
    }

    pub fn get<'a>(&self, row: &'a [String], name: &str) -> &'a str {
        self.column(name).and_then(|i| row.get(i)).map_or("", |s| s.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tabs_and_newlines_in_a_filename_become_spaces() {
        assert_eq!(escape("we\tird\nname"), "we ird name");
    }

    #[test]
    fn a_row_round_trips() {
        let mut buf = Vec::new();
        {
            let mut w = Writer::new(&mut buf, &["a", "b"]).unwrap();
            w.row(&["one".into(), "two".into()]).unwrap();
            w.row(&["three".into(), "four".into()]).unwrap();
        }
        let t = Table::read(&buf[..]).unwrap();
        assert_eq!(t.header, vec!["a", "b"]);
        assert_eq!(t.rows.len(), 2);
        assert_eq!(t.get(&t.rows[1], "b"), "four");
    }

    #[test]
    fn a_truncated_final_row_is_padded_not_discarded() {
        // An interrupted scan can leave a half-written line. Losing it would
        // silently drop a file from the index.
        let raw = "a\tb\tc\n1\t2\t3\n4\t5\n";
        let t = Table::read(raw.as_bytes()).unwrap();
        assert_eq!(t.rows.len(), 2);
        assert_eq!(t.get(&t.rows[1], "c"), "");
    }

    #[test]
    fn an_empty_file_reads_as_empty_rather_than_failing() {
        let t = Table::read(&b""[..]).unwrap();
        assert!(t.header.is_empty());
        assert!(t.rows.is_empty());
    }

    #[test]
    fn a_missing_column_reads_as_empty() {
        let t = Table::read("a\tb\n1\t2\n".as_bytes()).unwrap();
        assert_eq!(t.get(&t.rows[0], "nope"), "");
    }
}
