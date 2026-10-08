# Instagram analytics read fix

The live Media database capped REST responses at 1,000 rows. Content requested
30,000 snapshots sorted oldest first, so its totals missed October 8 snapshots
and read mostly September records. The database had over 16,000 snapshots.

Content now pages its reads, selects the current snapshot per published history
row, and reports required database failures instead of displaying empty totals.
Sync respects the selected platform and also reads the current snapshot per post.
Missing Instagram views preserve the previous count. YouTube daily writes only
count as successful after the database accepts them.

The chart uses provider-authored daily rows when available, otherwise observed
increases after the first valid snapshot. A first lifetime balance is excluded
from daily growth. Provider count corrections and recovery are not counted twice.
Cards show lifetime totals for posts published in the selected date range; these
are not account-wide reach or views gained during that date range.

## Optional SQL optimization

Run `supabase/migrations/20261008174813_analytics_snapshot_reads.sql` in the
Media database SQL Editor. It creates two private, security-invoker views and
indexes to read latest post counts and aggregate snapshot growth in Postgres.
The app detects them automatically. The paginated fallback works before SQL is
installed but loads more rows and is slower. The SQL retains existing records and
can be run again. It ends with a verification query grouped by workspace/platform.

The service-role API key permits existing table reads/writes; it is not a database
password or a Management API token and cannot apply this schema change by itself.

Tests cover row-cap pagination, current counts after more than 1,000 snapshots,
permission/error visibility, valid Instagram counts, baseline and correction
handling, parity between optimized and fallback reads, and existing inbox behavior.
The SQL was also executed twice against PostgreSQL fixtures to check output,
workspace mismatch exclusion, service-only grants and security-invoker settings.
