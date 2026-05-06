import argparse
import os
import time
from datetime import datetime, timezone
from typing import Any, Optional

import requests
from dotenv import load_dotenv
from supabase import create_client


load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

ALADHAN_BASE_URL = os.getenv("ALADHAN_BASE_URL", "https://api.aladhan.com/v1/calendar")
PROFILE_KEY = os.getenv("PROFILE_KEY", "aladhan_mwl_shafi_sweden_angle_based")

START_YEAR = int(os.getenv("START_YEAR", "2026"))
YEARS_TO_FETCH = int(os.getenv("YEARS_TO_FETCH", "2"))

REQUEST_SLEEP_SECONDS = float(os.getenv("REQUEST_SLEEP_SECONDS", "1.5"))
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "4"))

SUPABASE_PAGE_SIZE = 500

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def log(message: str) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] {message}", flush=True)


def get_profile() -> dict[str, Any]:
    result = (
        supabase
        .table("prayer_calculation_profiles")
        .select("*")
        .eq("key", PROFILE_KEY)
        .eq("active", True)
        .limit(1)
        .execute()
    )

    if not result.data:
        raise RuntimeError(f"No active prayer_calculation_profiles row found for key: {PROFILE_KEY}")

    return result.data[0]


def fetch_all_locations() -> list[dict[str, Any]]:
    all_rows: list[dict[str, Any]] = []
    start = 0

    while True:
        end = start + SUPABASE_PAGE_SIZE - 1

        result = (
            supabase
            .table("prayer_locations")
            .select("id,name,municipality_name,county_name,latitude,longitude,population")
            .eq("active", True)
            .order("population", desc=True)
            .range(start, end)
            .execute()
        )

        rows = result.data or []
        all_rows.extend(rows)

        if len(rows) < SUPABASE_PAGE_SIZE:
            break

        start += SUPABASE_PAGE_SIZE

    return all_rows


def build_month_list() -> list[tuple[int, int]]:
    months: list[tuple[int, int]] = []

    for year_offset in range(YEARS_TO_FETCH):
        year = START_YEAR + year_offset
        for month in range(1, 13):
            months.append((year, month))

    return months


def existing_months_for_location(location_id: str, profile_id: str) -> set[tuple[int, int]]:
    result = (
        supabase
        .table("prayer_time_months")
        .select("year,month")
        .eq("location_id", location_id)
        .eq("profile_id", profile_id)
        .execute()
    )

    return {
        (int(row["year"]), int(row["month"]))
        for row in (result.data or [])
    }


def clean_time(value: Any) -> Optional[str]:
    if value is None:
        return None

    text = str(value).strip()

    # Example: "04:59 (CET)" -> "04:59"
    if " " in text:
        text = text.split(" ")[0].strip()

    return text or None


def convert_day(item: dict[str, Any]) -> dict[str, Any]:
    timings = item.get("timings", {})
    date_data = item.get("date", {})

    gregorian = date_data.get("gregorian", {})
    hijri = date_data.get("hijri", {})

    gregorian_month = gregorian.get("month", {})
    hijri_month = hijri.get("month", {})

    gregorian_weekday = gregorian.get("weekday", {})
    hijri_weekday = hijri.get("weekday", {})

    return {
        "date": gregorian.get("date"),

        "gregorian_day": gregorian.get("day"),
        "gregorian_month_number": gregorian_month.get("number") if isinstance(gregorian_month, dict) else None,
        "gregorian_month_en": gregorian_month.get("en") if isinstance(gregorian_month, dict) else None,
        "gregorian_year": gregorian.get("year"),
        "gregorian_weekday_en": gregorian_weekday.get("en") if isinstance(gregorian_weekday, dict) else None,

        "hijri_date": hijri.get("date"),
        "hijri_day": hijri.get("day"),
        "hijri_month_number": hijri_month.get("number") if isinstance(hijri_month, dict) else None,
        "hijri_month_en": hijri_month.get("en") if isinstance(hijri_month, dict) else None,
        "hijri_year": hijri.get("year"),
        "hijri_weekday_en": hijri_weekday.get("en") if isinstance(hijri_weekday, dict) else None,

        "fajr": clean_time(timings.get("Fajr")),
        "sunrise": clean_time(timings.get("Sunrise")),
        "dhuhr": clean_time(timings.get("Dhuhr")),
        "asr": clean_time(timings.get("Asr")),
        "maghrib": clean_time(timings.get("Maghrib")),
        "isha": clean_time(timings.get("Isha")),

        "imsak": clean_time(timings.get("Imsak")),
        "sunset": clean_time(timings.get("Sunset")),
        "midnight": clean_time(timings.get("Midnight")),
        "firstthird": clean_time(timings.get("Firstthird")),
        "lastthird": clean_time(timings.get("Lastthird")),
    }


def fetch_aladhan_month(
    latitude: float,
    longitude: float,
    year: int,
    month: int,
    profile: dict[str, Any],
) -> list[dict[str, Any]]:
    url = f"{ALADHAN_BASE_URL}/{year}/{month}"

    params: dict[str, Any] = {
        "latitude": latitude,
        "longitude": longitude,
        "method": int(profile["method"]),
        "school": int(profile["school"]),
        "timezonestring": profile["timezone"],
        "iso8601": "false",
    }

    if profile.get("latitude_adjustment_method") is not None:
        params["latitudeAdjustmentMethod"] = int(profile["latitude_adjustment_method"])

    last_error: Optional[Exception] = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = requests.get(url, params=params, timeout=45)

            if response.status_code == 429:
                wait = attempt * 30
                log(f"Rate limited by Aladhan. Waiting {wait}s before retry.")
                time.sleep(wait)
                continue

            response.raise_for_status()
            body = response.json()

            if body.get("code") != 200:
                raise RuntimeError(f"Unexpected Aladhan response code: {body.get('code')} body={body}")

            data = body.get("data")

            if not isinstance(data, list):
                raise RuntimeError("Aladhan response data is not a list.")

            return data

        except Exception as error:
            last_error = error
            wait = attempt * 8
            log(f"Aladhan failed attempt {attempt}/{MAX_RETRIES}. Waiting {wait}s. Error: {error}")
            time.sleep(wait)

    raise RuntimeError(f"Aladhan failed after retries: {last_error}")


def upsert_prayer_month(
    location_id: str,
    profile_id: str,
    year: int,
    month: int,
    days: list[dict[str, Any]],
) -> None:
    payload = {
        "location_id": location_id,
        "profile_id": profile_id,
        "year": year,
        "month": month,
        "days": days,
        "source": "aladhan",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    (
        supabase
        .table("prayer_time_months")
        .upsert(
            payload,
            on_conflict="location_id,profile_id,year,month",
        )
        .execute()
    )


def run_import(
    only_name: Optional[str] = None,
    limit: Optional[int] = None,
    dry_run: bool = False,
) -> None:
    profile = get_profile()
    profile_id = profile["id"]

    locations = fetch_all_locations()

    if only_name:
        locations = [
            loc for loc in locations
            if str(loc["name"]).lower() == only_name.lower()
        ]

    if limit is not None:
        locations = locations[:limit]

    if not locations:
        raise RuntimeError("No locations found to import.")

    months = build_month_list()

    log(f"Profile: {profile['key']}")
    log(f"Method: {profile['method']}")
    log(f"School: {profile['school']}")
    log(f"Latitude adjustment method: {profile.get('latitude_adjustment_method')}")
    log(f"Timezone: {profile['timezone']}")
    log(f"Months to fetch: {months[0]} → {months[-1]}")
    log(f"Locations to process: {len(locations)}")
    log(f"Dry run: {dry_run}")

    total_saved = 0
    total_skipped = 0
    failures: list[dict[str, Any]] = []

    for index, location in enumerate(locations, start=1):
        location_id = location["id"]
        location_name = location["name"]
        municipality_name = location.get("municipality_name")
        county_name = location.get("county_name")
        latitude = float(location["latitude"])
        longitude = float(location["longitude"])

        log(
            f"[{index}/{len(locations)}] "
            f"{location_name}, {municipality_name}, {county_name} "
            f"({latitude}, {longitude})"
        )

        existing = existing_months_for_location(location_id, profile_id)

        for year, month in months:
            if (year, month) in existing:
                total_skipped += 1
                log(f"  Skipping {year}-{month:02d}, already exists.")
                continue

            try:
                log(f"  Fetching {year}-{month:02d} from Aladhan...")

                raw_days = fetch_aladhan_month(
                    latitude=latitude,
                    longitude=longitude,
                    year=year,
                    month=month,
                    profile=profile,
                )

                days = [convert_day(day) for day in raw_days]

                if len(days) < 28:
                    raise RuntimeError(f"Suspicious month length: {len(days)} days")

                if not dry_run:
                    upsert_prayer_month(
                        location_id=location_id,
                        profile_id=profile_id,
                        year=year,
                        month=month,
                        days=days,
                    )

                total_saved += 1
                log(f"  Saved {year}-{month:02d}: {len(days)} days")

                time.sleep(REQUEST_SLEEP_SECONDS)

            except Exception as error:
                log(f"  FAILED {location_name} {year}-{month:02d}: {error}")
                failures.append({
                    "location_id": location_id,
                    "location_name": location_name,
                    "year": year,
                    "month": month,
                    "error": str(error),
                })

                time.sleep(REQUEST_SLEEP_SECONDS * 3)

    log("Import finished.")
    log(f"Saved months: {total_saved}")
    log(f"Skipped existing months: {total_skipped}")
    log(f"Failures: {len(failures)}")

    if failures:
        log("Failure summary:")
        for failure in failures:
            log(str(failure))


def main() -> None:
    parser = argparse.ArgumentParser(description="Import Aladhan prayer times into Supabase.")

    parser.add_argument(
        "--only-name",
        type=str,
        default=None,
        help="Only import one exact location name, for example Stockholm.",
    )

    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only import the first N locations.",
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch data but do not save to Supabase.",
    )

    args = parser.parse_args()

    run_import(
        only_name=args.only_name,
        limit=args.limit,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
