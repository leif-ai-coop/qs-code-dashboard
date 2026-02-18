#!/usr/bin/env python3
"""
Enrich dashboard JSON with Bezeichnungen and per-year validity from icdops.de.
For OPS/ICD codes: check validity for the last 3 years (year, year-1, year-2).
For GOP/PZN/DRG/Sonstige: set placeholder katalog entries.
"""

import json
import os
import argparse
import urllib.request
from functools import lru_cache

BASE_URL = "https://icdops.de/data"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)

LOOKUP_TYPES = {'ops', 'icd'}
VALIDITY_WINDOW = 3  # check year, year-1, year-2


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


def lookup_code(code, typ, check_years, all_years):
    """Look up a code. Return (bezeichnung, {year: bool}, letzte_gueltigkeit)."""
    gueltigkeit = {}
    bezeichnung = None

    # Check each year in the validity window
    for y in check_years:
        kodes = lade_kodes(typ, str(y))
        if code in kodes:
            gueltigkeit[str(y)] = True
            if bezeichnung is None:
                bezeichnung = kodes[code]
        else:
            gueltigkeit[str(y)] = False

    # If not found in any check year, search older years for bezeichnung
    if bezeichnung is None:
        for y in all_years:
            if str(y) in [str(cy) for cy in check_years]:
                continue
            kodes = lade_kodes(typ, str(y))
            if code in kodes:
                bezeichnung = kodes[code]
                break

    # Determine letzte_gueltigkeit (most recent year where valid)
    letzte = None
    for y in sorted(gueltigkeit.keys(), reverse=True):
        if gueltigkeit[y]:
            letzte = y
            break
    if letzte is None:
        # Check older years beyond the window
        for y in all_years:
            ys = str(y)
            if ys in gueltigkeit:
                continue
            kodes = lade_kodes(typ, ys)
            if code in kodes:
                letzte = ys
                break

    return bezeichnung, gueltigkeit, letzte


def main():
    parser = argparse.ArgumentParser(description='Enrich dashboard JSON with code catalogs')
    parser.add_argument('--year', type=int, default=2025, help='Primary year (validity window: year to year-2)')
    args = parser.parse_args()
    year = args.year

    check_years = [year - i for i in range(VALIDITY_WINDOW)]  # [2025, 2024, 2023]

    dashboard_path = os.path.join(REPO_ROOT, "public", "data", f"dashboard_{year}.json")

    print(f"Loading {dashboard_path}...")
    with open(dashboard_path, 'r', encoding='utf-8') as f:
        dashboard = json.load(f)

    print("Loading available years from icdops.de...")
    resp = urllib.request.urlopen(f"{BASE_URL}/jahre.json")
    all_years = json.loads(resp.read().decode("utf-8"))
    print(f"  Verfuegbare Jahre: {all_years}")
    print(f"  Pruefungsfenster: {check_years}")

    # Pre-load catalogs for the check window
    print(f"\nPre-loading catalogs for {check_years}...")
    for y in check_years:
        for typ in LOOKUP_TYPES:
            lade_kodes(typ, str(y))

    codes_section = dashboard['codes']
    total_stats = {}

    for code_type, type_codes in codes_section.items():
        if not type_codes:
            continue

        if code_type in LOOKUP_TYPES:
            print(f"\nEnriching {len(type_codes)} {code_type.upper()} codes...")
            year_counts = {str(y): 0 for y in check_years}
            none_count = 0
            not_found = 0

            for code, data in type_codes.items():
                bez, gueltigkeit, letzte = lookup_code(code, code_type, check_years, all_years)

                katalog = {
                    'bezeichnung': bez or '',
                    'gueltigkeit': gueltigkeit,
                    'letzte_gueltigkeit': letzte or '',
                }
                data['katalog'] = katalog

                valid_in_any = False
                for y_str, valid in gueltigkeit.items():
                    if valid:
                        year_counts[y_str] = year_counts.get(y_str, 0) + 1
                        valid_in_any = True

                if not valid_in_any:
                    if letzte:
                        none_count += 1
                    else:
                        not_found += 1

            counts_str = ', '.join(f'{y}: {year_counts[str(y)]}' for y in check_years)
            print(f"  {code_type.upper()}: {counts_str}, aelter: {none_count}, nicht gefunden: {not_found}")

            for y in check_years:
                total_stats[f'{code_type}_gueltig_{y}'] = year_counts[str(y)]
            total_stats[f'{code_type}_nur_aelter'] = none_count
            total_stats[f'{code_type}_nicht_gefunden'] = not_found
        else:
            print(f"\n{code_type.upper()}: {len(type_codes)} codes — Platzhalter")
            for code, data in type_codes.items():
                data['katalog'] = {
                    'bezeichnung': '',
                    'gueltigkeit': {str(y): None for y in check_years},
                    'letzte_gueltigkeit': '',
                }

    dashboard['meta']['katalog_quelle'] = 'icdops.de (OPS + ICD)'
    dashboard['meta']['katalog_pruefungsjahre'] = check_years
    dashboard['meta']['katalog_alle_jahre'] = all_years
    dashboard['meta']['statistik'].update(total_stats)

    print(f"\nWriting enriched data...")
    with open(dashboard_path, 'w', encoding='utf-8') as f:
        json.dump(dashboard, f, ensure_ascii=False, separators=(',', ':'))

    fsize = os.path.getsize(dashboard_path) / (1024 * 1024)
    print(f"Done! Size: {fsize:.1f} MB")


if __name__ == '__main__':
    main()
