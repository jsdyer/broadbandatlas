# Broadband Atlas

Broadband Atlas joins reported household coverage, provider technologies, and mapped project layers in one browser. Search by community, coordinates or hexagon ID, inspect individual cells, combine filters, and export matching records. Langley and Halifax shortcuts start a 35 km browse. All provinces and territories are available. Radius searches are scoped to the selected province or territory.

## Build and run

```sh
python3 scripts/build.py
python3 -m http.server 8000 --directory dist
```

Open http://localhost:8000. For a repeat build, pass `--coverage`, `--grid` and `--leaflet` with saved upstream archives. The GitHub Pages workflow tests, builds, and deploys on pushes, manual dispatch, and monthly refreshes. It preserves the last live snapshot if an upstream download or schema check fails.

## Sources

- [ISED National Broadband Data](https://open.canada.ca/data/en/dataset/00a331db-121b-445d-b119-35dbbe3eedd9) provides the 50/10 Mbps coverage bands, community points, provider/technology entries, and project layers. Projects without a published household coverage estimate can still be inspected. The atlas presents programme flags and links to the funding agencies' project lists.
- [Canadian hex grid](https://open.canada.ca/data/en/dataset/4129e42c-bfa6-40f1-9b2a-19dc04136bb4) provides centre coordinates joined by the official cell identifier. Community region assignments use the nearest grid centre. Map dots and distances use cell centres. The grid and coverage archives have separate dates.
- [OpenStreetMap](https://www.openstreetmap.org/copyright) supplies optional background tiles. Leaflet is checked against a pinned npm package checksum and served locally.
- Broadband and geographic data contain information licensed under the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada).

Coverage bands are area estimates. Availability at an address, measured speeds, and project completion require separate checks. A single cell may have several overlapping programme flags.

## Location evidence report

Search for a community, coordinates, or grid ID and choose **Build location report**. A grid result also offers **Report from this grid centre**. The report compares the nearest or selected ISED broadband cell and nearby project layers with fixed-service and terrestrial records from Spectrum Atlas and CRTC 50/10 Mbps pricing from Telecom Pulse. Use **Print or save PDF** for a copy, or share the browser URL to reopen the report.

The report labels the source dates and geographic scope of each layer. Project counts refer to grid cells. Spectrum Atlas supplies BC and NS extracts only. CRTC prices describe sampled rural and urban markets and use the latest year with both provincial and national data for a market when available. The two companion snapshots are requested from the same CoolCode site, with independent fallbacks if either source is unavailable.
