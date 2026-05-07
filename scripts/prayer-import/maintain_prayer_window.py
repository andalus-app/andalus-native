import argparse
from typing import Any

from fetch_prayer_times_to_supabase import (
    REQUEST_SLEEP_SECONDS,
    convert_day,
    fetch_aladhan_month,
    fetch_all_locations,
    get_profile,
    log,
    supabase,
    time,
    upsert_prayer_month,
)


PROFILE_KEY = "aladhan_mwl_shafi_sweden_angle_based"


def add_months(year: int, month: int, offset: int) -> tuple[int, int]:
    total = (year * 12 + (month - 1)) + offset
    new_year = total // 12
    new_month = (total % 12) + 1
    return new_year, new_month


def get_min_max_month(profile_id: str) -> tuple[tuple[int, int], tuple[int, int]]:
    result = (
        supabase
        .table("prayer_time_months")
        .select("year,month")
        .eq("profile_id", profile_id)
        .execute()
    )

    rows = result.data or []

    if not rows:
        raise RuntimeError("No existing prayer_time_months rows found. Initial 24-month import must be completed first.")

    months = sorted({
        (int(row["year"]), int(row["month"]))
        for row in rows
    })

    return months[0], months[-1]


def get_existing_locations_for_month(
    profile_id: str,
    year: int,
    month: int,
) -> set[str]:
    result = (
        supabase
        .table("prayer_time_months")
        .select("location_id")
        .eq("profile_id", profile_id)
        .eq("year", year)
        .eq("month", month)
        .execute()
    )

    return {
        str(row["location_id"])
        for row in (result.data or [])
    }


def get_month_status(year: int, month: int) -> dict[str, Any]:
    result = (
        supabase
        .rpc(
            "get_prayer_month_status",
            {
                "input_year": year,
                "input_month": month,
                "input_profile_key": PROFILE_KEY,
            },
        )
        .execute()
    )

    if not result.data:
        raise RuntimeError(f"No month status returned for {year}-{month:02d}")

    return result.data[0]


def delete_exact_month(year: int, month: int) -> int:
    result = (
        supabase
        .rpc(
            "delete_prayer_month",
            {
                "input_year": year,
                "input_month": month,
                "input_profile_key": PROFILE_KEY,
            },
        )
        .execute()
    )

    return int(result.data or 0)


def fetch_target_month_for_location(
    location: dict[str, Any],
    profile: dict[str, Any],
    profile_id: str,
    year: int,
    month: int,
    dry_run: bool,
) -> None:
    location_id = location["id"]
    location_name = location["name"]

    latitude = float(location["latitude"])
    longitude = float(location["longitude"])

    log(f"Fetching {location_name} {year}-{month:02d}")

    raw_days = fetch_aladhan_month(
        latitude=latitude,
        longitude=longitude,
        year=year,
        month=month,
        profile=profile,
    )

    days = [convert_day(day) for day in raw_days]

    if len(days) < 28:
        raise RuntimeError(f"Suspicious month length for {location_name} {year}-{month:02d}: {len(days)}")

    if not dry_run:
        upsert_prayer_month(
            location_id=location_id,
            profile_id=profile_id,
            year=year,
            month=month,
            days=days,
        )

    log(f"Saved {location_name} {year}-{month:02d}: {len(days)} days")


def run_monthly_rollover(
    cleanup: bool,
    dry_run: bool,
) -> None:
    log("Monthly prayer time rollover started.")
    log(f"Cleanup enabled: {cleanup}")
    log(f"Dry run: {dry_run}")

    profile = get_profile()
    profile_id = profile["id"]

    oldest_month, newest_month = get_min_max_month(profile_id)

    oldest_year, oldest_month_number = oldest_month
    newest_year, newest_month_number = newest_month

    target_year, target_month = add_months(
        newest_year,
        newest_month_number,
        1,
    )

    log(f"Oldest existing month: {oldest_year}-{oldest_month_number:02d}")
    log(f"Newest existing month: {newest_year}-{newest_month_number:02d}")
    log(f"Target new month: {target_year}-{target_month:02d}")

    locations = fetch_all_locations()
    expected_locations = len(locations)

    existing_location_ids = get_existing_locations_for_month(
        profile_id=profile_id,
        year=target_year,
        month=target_month,
    )

    missing_locations = [
        location
        for location in locations
        if str(location["id"]) not in existing_location_ids
    ]

    log(f"Active locations: {expected_locations}")
    log(f"Already imported for target month: {len(existing_location_ids)}")
    log(f"Missing for target month: {len(missing_locations)}")

    saved = 0
    failures: list[dict[str, Any]] = []

    for index, location in enumerate(missing_locations, start=1):
        try:
            log(f"[{index}/{len(missing_locations)}] {location['name']}")

            fetch_target_month_for_location(
                location=location,
                profile=profile,
                profile_id=profile_id,
                year=target_year,
                month=target_month,
                dry_run=dry_run,
            )

            saved += 1
            time.sleep(REQUEST_SLEEP_SECONDS)

        except Exception as error:
            log(f"FAILED {location['name']} {target_year}-{target_month:02d}: {error}")

            failures.append({
                "location_id": location["id"],
                "location_name": location["name"],
                "year": target_year,
                "month": target_month,
                "error": str(error),
            })

            time.sleep(REQUEST_SLEEP_SECONDS * 3)

    log(f"Saved new rows: {saved}")
    log(f"Failures: {len(failures)}")

    if failures:
        log("Rollover finished with failures. Old month will NOT be deleted.")
        for failure in failures:
            log(str(failure))
        raise RuntimeError("Monthly rollover failed. Cleanup blocked.")

    if dry_run:
        log("Dry run enabled. Verification and cleanup skipped.")
        return

    status = get_month_status(target_year, target_month)

    log(
        f"Verification {target_year}-{target_month:02d}: "
        f"{status['actual_locations']}/{status['expected_locations']} complete"
    )

    if not status["is_complete"]:
        log("Target month is incomplete. Old month will NOT be deleted.")
        log(str(status))
        raise RuntimeError("Target month incomplete. Cleanup blocked.")

    if cleanup:
        deleted = delete_exact_month(oldest_year, oldest_month_number)
        log(f"Deleted oldest month {oldest_year}-{oldest_month_number:02d}. Rows deleted: {deleted}")
    else:
        log("Cleanup disabled. Old month was NOT deleted.")

    log("Monthly prayer time rollover completed successfully.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Add exactly one new prayer month and optionally delete exactly one old month.")

    parser.add_argument(
        "--cleanup",
        action="store_true",
        help="Delete the oldest month only after the new target month is complete.",
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch target month without writing or deleting.",
    )

    args = parser.parse_args()

    run_monthly_rollover(
        cleanup=args.cleanup,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
