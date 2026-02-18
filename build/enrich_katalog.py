#!/usr/bin/env python3
"""
Enrich dashboard JSON with Bezeichnungen and validity from icdops.de.
For OPS/ICD codes: look up in primary year catalog, fallback to older years.
For GOP/PZN/DRG/Sonstige: set placeholder katalog entries.
"""

import json
import os
import sys
import argparse
import urllib.request
from functools import lru_cache

BASE_URL = "https://icdops.de/data"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)

LOOKUP_TYPES = {'ops', 'icd'}


@lru_cache(maxsize=32)
def lade_kodes(typ, jahr):
    if typ == "icd":
        url = f"{BASE_URL}/{jahr}/icd10/icd10gm{jahr}syst_kodes.txt"
    else:
        url = f"{BASE_URL}/{jahr}/ops/ops{jahr}syst_kodes.txt"

    print(f"  Downloading {typ.upper()} {jahr}...", end=" ", flush=True)
    resp = urllib.request.urlopen(url)
    text = resp.read().decode("utf-8")

    codes = {}
    for zeile in text.strip().split("\n"):
        felder = zeile.split(";")
        if len(felder) > 8:
            codes[felder[6]] = felder[8]

    print(f"{len(codes)} codes")
    return codes


def lookup_code(code, typ, primary_year, alle_jahre):
    kodes_primary = lade_kodes(typ, str(primary_year))
    if code in kodes_primary:
        return kodes_primary[code], True, str(primary_year)

    for jahr in alle_jahre:
        if str(jahr) == str(primary_year):
            continue
        kodes = lade_kodes(typ, str(jahr))
        if code in kodes:
            return kodes[code], False, str(jahr)

    return None, False, None


def main():
    parser = argparse.ArgumentParser(description='Enrich dashboard JSON with code catalogs')
    parser.add_argument('--year', type=int, default=2025, help='Primary year for validity check')
    args = parser.parse_args()
    year = args.year

    dashboard_path = os.path.join(REPO_ROOT, "public", "data", f"dashboard_{year}.json")

    print(f"Loading {dashboard_path}...")
    with open(dashboard_path, 'r', encoding='utf-8') as f:
        dashboard = json.load(f)

    print("Loading available years from icdops.de...")
    resp = urllib.request.urlopen(f"{BASE_URL}/jahre.json")
    alle_jahre = json.loads(resp.read().decode("utf-8"))
    print(f"  Jahre: {alle_jahre}")

    print(f"\nPre-loading {year} catalogs...")
    lade_kodes("ops", str(year))
    lade_kodes("icd", str(year))

    codes_section = dashboard['codes']
    total_stats = {}

    for code_type, type_codes in codes_section.items():
        if not type_codes:
            continue

        if code_type in LOOKUP_TYPES:
            print(f"\nEnriching {len(type_codes)} {code_type.upper()} codes...")
            found_primary = 0
            found_older = 0
            not_found = 0

            for code, data in type_codes.items():
                bez, gueltig, letzte = lookup_code(code, code_type, year, alle_jahre)
                data['katalog'] = {
                    'bezeichnung': bez or '',
                    f'gueltig_{year}': gueltig,
                    'letzte_gueltigkeit': letzte or '',
                }
                if gueltig:
                    found_primary += 1
                elif letzte:
                    found_older += 1
                else:
                    not_found += 1

            print(f"  {code_type.upper()}: {found_primary} in {year}, {found_older} in aelterem Jahr, {not_found} nicht gefunden")
            total_stats[f'{code_type}_gueltig_{year}'] = found_primary
            total_stats[f'{code_type}_nicht_gueltig_{year}'] = found_older
            total_stats[f'{code_type}_nicht_gefunden'] = not_found
        else:
            print(f"\n{code_type.upper()}: {len(type_codes)} codes — Platzhalter")
            for code, data in type_codes.items():
                data['katalog'] = {
                    'bezeichnung': '',
                    f'gueltig_{year}': None,
                    'letzte_gueltigkeit': '',
                }

    dashboard['meta']['katalog_quelle'] = 'icdops.de (OPS + ICD)'
    dashboard['meta']['katalog_primaerjahr'] = str(year)
    dashboard['meta']['katalog_fallback_jahre'] = alle_jahre
    dashboard['meta']['statistik'].update(total_stats)

    print(f"\nWriting enriched data...")
    with open(dashboard_path, 'w', encoding='utf-8') as f:
        json.dump(dashboard, f, ensure_ascii=False, separators=(',', ':'))

    fsize = os.path.getsize(dashboard_path) / (1024 * 1024)
    print(f"Done! Size: {fsize:.1f} MB")


if __name__ == '__main__':
    main()
