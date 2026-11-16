#!/usr/bin/env python3
"""Join ISED broadband coverage, provider and funding records to the Canadian grid."""
import argparse
from collections import defaultdict
from contextlib import contextmanager
import csv
from datetime import date
import hashlib
import io
import json
import math
from pathlib import Path
import shutil
import tarfile
import tempfile
from time import sleep
from urllib.request import Request, urlopen
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://ised-isde.canada.ca/app/scr/sittibc/web/api/openData/'
MAP = BASE + 'Map_Data_CSV.zip'
GRID = BASE + 'CHX_EXO_CSV.zip'
LEAFLET = 'https://registry.npmjs.org/leaflet/-/leaflet-1.9.4.tgz'
LEAFLET_SHA512 = ('9f14b5ca7cc93a63a51e9fa22f71725aa2bcf46b4d2fc53caef94c3ac41d4d3b2c'
                  'c59c025e1f0dd8d07718340e2fe611dd79d6c99031c108b15116fe140ef83c')
KEY = 'HEXuid_HEXidu'
REGIONS = dict(BC='British Columbia', NS='Nova Scotia', AB='Alberta', MB='Manitoba',
               NB='New Brunswick', NL='Newfoundland and Labrador', NT='Northwest Territories',
               NU='Nunavut', ON='Ontario', PE='Prince Edward Island', QC='Quebec',
               SK='Saskatchewan', YT='Yukon')
BANDS = ('0', '>0% - 25%', '>25% - 50%', '>50% - 75%', '>75% - 100%')
FUNDING = (
    ('UBF_Core_', 'Universal Broadband Fund'),
    ('UBF_RRS_', 'Universal Broadband Fund Rapid Response Stream'),
    ('CRTC_Proj_', 'CRTC Broadband Fund'),
    ('ProvTerr_Proj_', 'Provincial or territorial project'),
    ('CTI_Hex_', 'Connect to Innovate'),
    ('CCP_Hex_', 'Connecting Canadians'),
    ('CIB_Proj_', 'Canada Infrastructure Bank'),
    ('INFC_Proj_', 'Infrastructure Canada'),
    ('ISC_Proj_', 'Indigenous Services Canada'),
    ('PrivExp_Proj_', 'Anticipated private-sector expansion'),
)


def download(url, target, limit):
    for attempt in range(3):
        try:
            request = Request(url, headers={'User-Agent': 'CoolCode Broadband Atlas data build'})
            with urlopen(request, timeout=40) as response, target.open('wb') as output:
                size = 0
                while chunk := response.read(1024 * 1024):
                    size += len(chunk)
                    if size > limit:
                        raise ValueError(f'Maximum size exceeded for {url}')
                    output.write(chunk)
            return
        except OSError:
            if attempt == 2:
                raise
            sleep(2 ** attempt)


@contextmanager
def table(archive, prefix, columns):
    matching = [item for item in archive.infolist() if item.filename.startswith(prefix)]
    if len(matching) != 1 or matching[0].file_size > 120 * 1024**2:
        raise ValueError(f'Unexpected archive contents for {prefix}')
    with archive.open(matching[0]) as file:
        rows = csv.DictReader(io.TextIOWrapper(file, encoding='utf-8-sig', newline=''))
        if set(columns).difference(rows.fieldnames or []):
            raise ValueError(f'Unexpected official CSV columns in {matching[0].filename}')
        yield rows, date(*matching[0].date_time[:3]).isoformat()


def points(grid):
    result = {}
    buckets = defaultdict(list)
    with table(grid, 'CHX_EXO.csv', (KEY, 'Latitude', 'Longitude')) as (rows, vintage):
        for row in rows:
            key = row[KEY]
            if key[:2] not in REGIONS:
                continue
            lat = float(row['Latitude'])
            lon = float(row['Longitude'])
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                raise ValueError('Canadian grid coordinates out of bounds')
            result[key] = (round(lat, 5), round(lon, 5))
            buckets[(math.floor(lat), math.floor(lon))].append((lat, lon, key[:2]))
    return result, buckets, vintage


def province_for(buckets, lat, lon):
    scale = math.cos(math.radians(lat))
    a, b = math.floor(lat), math.floor(lon)
    nearby = (point for dy in (-1, 0, 1) for dx in (-1, 0, 1)
              for point in buckets.get((a + dy, b + dx), ()))
    closest = min(nearby, key=lambda p: (lat - p[0])**2 + ((lon - p[1]) * scale)**2, default=None)
    return closest[2] if closest else None


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')


def index_data(coverage, grid, output):
    geo, buckets, geo_date = points(grid)
    records = {}
    with table(coverage, 'Data_Hex_', (KEY, 'Expr2', 'SumURD_2021_SommeRH')) as (rows, coverage_date):
        for row in rows:
            key = row[KEY]
            if key not in geo:
                continue
            band = ' '.join(row['Expr2'].split())
            if band not in BANDS:
                raise ValueError(f'Unrecognized coverage band: {band}')
            dwellings = row['SumURD_2021_SommeRH'].strip()
            records[key] = [key, *geo[key], BANDS.index(band), dwellings or '-', [], 0]
    if len(records) < 1000:
        raise ValueError('Coverage data appears incomplete')

    services = {}
    with table(coverage, 'ISP_Hex_', (KEY, 'Name_Nom', 'Technology')) as (rows, _):
        for row in rows:
            record = records.get(row[KEY])
            service = (row['Name_Nom'].strip(), row['Technology'].strip())
            if record is not None and all(service):
                record[5].append(services.setdefault(service, len(services)))
    for bit, (prefix, _) in enumerate(FUNDING):
        with table(coverage, prefix, (KEY,)) as (rows, _):
            for row in rows:
                key = row[KEY]
                if key in geo:
                    records.setdefault(key, [key, *geo[key], None, '-', [], 0])[6] |= 1 << bit

    groups = defaultdict(list)
    for record in records.values():
        record[5] = sorted(set(record[5]))
        groups[record[0][:2]].append(record)
    for region, subset in groups.items():
        write_json(output / f'{region}.json', sorted(subset, key=lambda row: row[0]))

    communities = []
    with table(coverage, 'Data_Com_Points_', ('Name_en', 'Nom_fr', 'Latitude', 'Longitude')) as (rows, _):
        for row in rows:
            lat, lon = float(row['Latitude']), float(row['Longitude'])
            province = province_for(buckets, lat, lon)
            name = row['Name_en'] or row['Nom_fr']
            if province and name:
                communities.append([name, province, round(lat, 5), round(lon, 5)])
    write_json(output / 'places.json', sorted(communities))
    write_json(output / 'index.json', {
        'coverageDate': coverage_date, 'gridDate': geo_date, 'built': date.today().isoformat(),
        'regions': [[key, name, len(groups[key])] for key, name in REGIONS.items()],
        'services': list(services), 'funds': [name for _, name in FUNDING],
        'technologies': sorted({tech for _, tech in services}),
    })
    print(f'{len(records):,} grid cells; {len(communities):,} places; {len(services):,} provider and technology pairings')


def vendor(path, output):
    if hashlib.sha512(path.read_bytes()).hexdigest() != LEAFLET_SHA512:
        raise ValueError('Unexpected Leaflet package checksum')
    filenames = {
        'package/dist/leaflet.js': 'leaflet.js',
        'package/dist/leaflet.css': 'leaflet.css',
        'package/LICENSE': 'LEAFLET-LICENSE.txt',
    }
    with tarfile.open(path, 'r:gz') as archive:
        for member, target in filenames.items():
            with archive.extractfile(member) as source, (output / target).open('wb') as file:
                shutil.copyfileobj(source, file)


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--coverage', type=Path)
    cli.add_argument('--grid', type=Path)
    cli.add_argument('--leaflet', type=Path)
    cli.add_argument('--output', type=Path, default=ROOT / 'dist')
    options = cli.parse_args()
    options.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='broadband-', dir=options.output.parent) as folder:
        work = Path(folder)
        inputs = []
        for path, url, name, limit in (
            (options.coverage, MAP, 'map.zip', 32),
            (options.grid, GRID, 'grid.zip', 32),
            (options.leaflet, LEAFLET, 'leaflet.tgz', 2),
        ):
            if path is None:
                path = work / name
                download(url, path, limit * 1024**2)
            inputs.append(path)
        output = work / 'site'
        shutil.copytree(ROOT / 'web', output)
        (output / 'data').mkdir()
        with ZipFile(inputs[0]) as coverage, ZipFile(inputs[1]) as grid:
            index_data(coverage, grid, output / 'data')
        vendor(inputs[2], output)
        if options.output.exists():
            shutil.rmtree(options.output)
        output.replace(options.output)


if __name__ == '__main__':
    main()
