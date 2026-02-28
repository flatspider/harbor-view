#!/usr/bin/env python3
"""
Fetch OpenStreetMap street data for the NY Harbor bounding box
and export as GeoJSON for the harbor-watch 3D scene.

Bounding box matches NY_HARBOR_BOUNDS from src/types/ais.ts:
  south: 40.48, north: 40.92, west: -74.26, east: -73.75

Usage:
  source .venv/bin/activate
  python scripts/fetch-osm-streets.py
"""

import json
import os
import osmnx as ox

# ── NY Harbor Bounding Box (matches src/types/ais.ts) ────────────────
SOUTH = 40.48
NORTH = 40.92
WEST = -74.26
EAST = -73.75

# Output path
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "data")
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "harbor-streets.geojson")


def fetch_streets():
    print(f"Fetching OSM street network for bbox:")
    print(f"  N={NORTH}, S={SOUTH}, E={EAST}, W={WEST}")
    print()

    # Download the street network as a graph
    # network_type="drive" gets driveable roads; use "all" for everything
    G = ox.graph_from_bbox(
        bbox=(NORTH, SOUTH, EAST, WEST),
        network_type="drive",
        simplify=True,
    )

    node_count = G.number_of_nodes()
    edge_count = G.number_of_edges()
    print(f"Downloaded graph: {node_count:,} nodes, {edge_count:,} edges")

    # Convert to GeoDataFrames
    nodes_gdf, edges_gdf = ox.graph_to_gdfs(G)

    # Keep only the edge geometries (the street lines)
    # Select useful columns if they exist
    keep_cols = ["geometry", "name", "highway", "lanes", "maxspeed", "oneway", "length"]
    available = [c for c in keep_cols if c in edges_gdf.columns]
    streets_gdf = edges_gdf[available].copy()

    # Convert MultiIndex to regular index for clean GeoJSON
    streets_gdf = streets_gdf.reset_index(drop=True)

    # Flatten list-type columns (OSM sometimes returns lists for name, highway, etc.)
    for col in streets_gdf.columns:
        if col == "geometry":
            continue
        streets_gdf[col] = streets_gdf[col].apply(
            lambda v: v[0] if isinstance(v, list) and len(v) > 0 else v
        )

    # Ensure output directory exists
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Write GeoJSON
    streets_gdf.to_file(OUTPUT_FILE, driver="GeoJSON")

    # Report file size
    size_mb = os.path.getsize(OUTPUT_FILE) / (1024 * 1024)
    feature_count = len(streets_gdf)
    print(f"\nWrote {feature_count:,} street segments to:")
    print(f"  {os.path.abspath(OUTPUT_FILE)}")
    print(f"  Size: {size_mb:.1f} MB")

    # Print highway type breakdown
    if "highway" in streets_gdf.columns:
        print("\nStreet types:")
        counts = streets_gdf["highway"].value_counts()
        for htype, count in counts.items():
            print(f"  {htype}: {count:,}")


if __name__ == "__main__":
    fetch_streets()
