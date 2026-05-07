import os
from pathlib import Path

import geopandas as gpd
from dotenv import load_dotenv
from supabase import create_client


load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

GPKG_PATH = Path("../../Tatorter_2023.gpkg")


def main():
    if not GPKG_PATH.exists():
        raise FileNotFoundError(f"Could not find GeoPackage at: {GPKG_PATH.resolve()}")

    print("Reading GeoPackage...")
    gdf = gpd.read_file(GPKG_PATH)

    print(f"Rows: {len(gdf)}")
    print(f"Original CRS: {gdf.crs}")
    print(f"Columns: {list(gdf.columns)}")

    # Convert from SWEREF 99 TM / EPSG:3006 to WGS84 / EPSG:4326
    gdf = gdf.to_crs(4326)

    updated = 0
    failed = 0

    for index, row in gdf.iterrows():
        source_id = str(row["tatortskod"])
        geometry = row.geometry

        if geometry is None or geometry.is_empty:
            print(f"Skipping empty geometry for {source_id}")
            failed += 1
            continue

        try:
            wkt = geometry.wkt

            supabase.rpc(
                "update_prayer_location_boundary",
                {
                    "input_source_id": source_id,
                    "input_wkt": wkt,
                },
            ).execute()

            updated += 1

            if updated % 100 == 0:
                print(f"Updated {updated} boundaries...")

        except Exception as error:
            failed += 1
            print(f"FAILED {source_id}: {error}")

    print("Done")
    print(f"Updated: {updated}")
    print(f"Failed: {failed}")


if __name__ == "__main__":
    main()
