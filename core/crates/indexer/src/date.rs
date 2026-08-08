//! Civil dates from unix timestamps, without pulling in a date library.
//!
//! The index stores modification dates as `YYYY-MM-DD` strings so that sorting
//! them lexically sorts them chronologically.

/// Convert a unix timestamp to a `YYYY-MM-DD` string in UTC.
///
/// Uses Howard Hinnant's days-from-civil algorithm run in reverse. It is exact
/// for the whole proleptic Gregorian calendar, which matters because this
/// archive contains files stamped in the 1990s.
pub fn ymd(unix_secs: i64) -> String {
    let days = unix_secs.div_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    // Shift the epoch to 0000-03-01 so leap days land at the end of the cycle.
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11], March-based
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_is_the_first_of_january_1970() {
        assert_eq!(ymd(0), "1970-01-01");
    }

    #[test]
    fn handles_dates_before_the_epoch() {
        // Files carried across decades of backups genuinely have these stamps.
        assert_eq!(ymd(-1), "1969-12-31");
        assert_eq!(ymd(-86_400), "1969-12-31");
    }

    #[test]
    fn handles_leap_days() {
        // 2000 was a leap year; 1900 was not, which is the case naive
        // implementations get wrong.
        assert_eq!(ymd(951_782_400), "2000-02-29");
        assert_eq!(ymd(1_709_164_800), "2024-02-29");
    }

    #[test]
    fn matches_known_timestamps() {
        assert_eq!(ymd(1_000_000_000), "2001-09-09");
        assert_eq!(ymd(1_700_000_000), "2023-11-14");
    }

    #[test]
    fn a_time_late_in_the_day_does_not_roll_over() {
        assert_eq!(ymd(86_399), "1970-01-01");
        assert_eq!(ymd(86_400), "1970-01-02");
    }
}
