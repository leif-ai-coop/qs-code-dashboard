#!/usr/bin/env python3
"""
Rebuild dashboard JSON from QSF, SDAT (MDB) and QIDB Rechenregellisten (CSV).
Supports --year parameter for multi-year builds.
"""

import json
import re
import os
import csv
import argparse
from collections import defaultdict
from access_parser import AccessParser

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)

# All supported code type buckets
CODE_TYPES = ['ops', 'icd', 'gop', 'pzn', 'drg', 'sonstige']

# === QSF: Module -> Verfahren mapping (covers both 2025 and 2026) ===
# Modules not listed here are standalone (e.g., state-specific like SA_HESSEN)
QSF_MODULE_VERFAHREN = {
    # QS PCI
    'PCI': 'QS PCI', 'PCIKORO': 'QS PCI', 'PCI_LKG': 'QS PCI', 'PCI_KV': 'QS PCI', 'PCI_SV': 'QS PCI',
    'PPCI': 'QS PCI', 'PPCI_LKG': 'QS PCI', 'PPCI_KV': 'QS PCI', 'PPCI_SV': 'QS PCI',
    # QS WI
    'NWIF': 'QS WI',
    # QS CHE
    'CHE': 'QS CHE',
    # QS NET
    'DIAL': 'QS NET', 'DIAL_LKG': 'QS NET', 'DIAL_KV': 'QS NET', 'DIAL_SV': 'QS NET', 'PNTX': 'QS NET',
    # QS TX
    'NLS': 'QS TX', 'LTX': 'QS TX', 'LLS': 'QS TX', 'LUTX': 'QS TX',
    'HTXM': 'QS TX', 'HTXM_MKU': 'QS TX', 'HTXM_TX': 'QS TX',
    # QS KCHK
    'HCH': 'QS KCHK', 'HCH_AK_CHIR': 'QS KCHK', 'HCH_AK_KATH': 'QS KCHK',
    'HCH_KC': 'QS KCHK', 'HCH_MK_CHIR': 'QS KCHK', 'HCH_MK_KATH': 'QS KCHK',
    # QS KAROTIS
    'CAR': 'QS KAROTIS', '10/2': 'QS KAROTIS',
    # QS CAP
    'PNEU': 'QS CAP',
    # QS MC
    'MAM': 'QS MC', '18/1': 'QS MC',
    # QS GYN-OP
    'GYN': 'QS GYN-OP', '15/1': 'QS GYN-OP',
    # QS DEK
    'DEK': 'QS DEK',
    # QS HSMDEF
    'SMIMPL': 'QS HSMDEF', 'SMAGGW': 'QS HSMDEF', 'SMREV': 'QS HSMDEF',
    'ICDIMPL': 'QS HSMDEF', 'ICDAGGW': 'QS HSMDEF', 'ICDREV': 'QS HSMDEF',
    '09/1': 'QS HSMDEF', '09/2': 'QS HSMDEF', '09/3': 'QS HSMDEF',
    '09/4': 'QS HSMDEF', '09/5': 'QS HSMDEF', '09/6': 'QS HSMDEF',
    # QS PM
    'GEB': 'QS PM', '16/1': 'QS PM', 'NEO': 'QS PM',
    # QS HGV
    'HEP': 'QS HGV', 'HEP_WE': 'QS HGV', 'HEP_IMP': 'QS HGV', 'SH': 'QS HGV', '17/1': 'QS HGV',
    'UKNIETEP': 'QS HGV',
    # QS KEP
    'KEP': 'QS KEP', 'KEP_WE': 'QS KEP', 'KEP_IMP': 'QS KEP',
    # QS APSY
    'APSY': 'QS APSY', 'PAPSY': 'QS APSY', 'APSY_KV': 'QS APSY', 'APSY_SV': 'QS APSY',
    'PAPSY_KV': 'QS APSY', 'PAPSY_SV': 'QS APSY',
}

# === SDAT: Module -> Verfahren mapping ===
SDAT_MODULE_VERFAHREN = {
    'PCI': 'QS PCI', 'CHOL': 'QS CHE', 'NWITR': 'QS WI', 'NWIWI': 'QS WI',
    'KCHK': 'QS KCHK', 'DIALS': 'QS NET', 'NTXS': 'QS NET',
    'HTXS': 'QS TX', 'LTXS': 'QS TX', 'LUTXS': 'QS TX',
    'HGVS': 'QS HGV', 'KEPS': 'QS KEP', 'NEOVS': 'QS PM',
    'SEPS': 'QS SEP', 'KFEDK': 'oKFE DK', 'KFEZK': 'oKFE ZK',
    'EOS': 'MM EOS', 'ENEOS': 'MM ENEO',
}

SDAT_SKIP_MODULES = {'BSP', 'AUFST'}

# === QIDB: CSV-Verfahren -> QS-Verfahren mapping ===
QIDB_VERFAHREN_MAP = {
    'PCI': 'QS PCI',
    'CHE': 'QS CHE',
    'DEK': 'QS DEK',
    'GYN-OP': 'QS GYN-OP',
    'MC': 'QS MC',
    'AmbPT': 'QS APSY',
    'NET-DIAL': 'QS NET',
    'PM-GEBH': 'QS PM',
    'PM-NEO': 'QS PM',
    'HGV-HEP': 'QS HGV',
    'HGV-OSFRAK': 'QS HGV',
    'HSMDEF-DEFI-IMPL': 'QS HSMDEF',
    'HSMDEF-HSM-IMPL': 'QS HSMDEF',
    'KCHK-AK-CHIR': 'QS KCHK',
    'KCHK-AK-KATH': 'QS KCHK',
    'KCHK-KC': 'QS KCHK',
    'KCHK-KC-KOMB': 'QS KCHK',
    'KCHK-MK-CHIR': 'QS KCHK',
    'KCHK-MK-KATH': 'QS KCHK',
    'WI-NI-A': 'QS WI',
    'WI-NI-S': 'QS WI',
}

# QIDB CSV typ -> normalized code type
QIDB_TYP_MAP = {
    'OPS': 'ops',
    'ICD': 'icd',
    'GOP': 'gop',
    'PZN': 'pzn',
    'FA_SP Code': 'sonstige',
}


# === HELPER FUNCTIONS ===

def clean_val(val):
    if val is None:
        return ''
    if isinstance(val, bytes):
        try:
            return val.decode('utf-8').strip()
        except:
            return val.decode('latin-1').strip()
    return str(val).strip()


def table_to_rows(db, table_name):
    data = db.parse_table(table_name)
    cols = list(data.keys())
    n_rows = len(data[cols[0]]) if cols else 0
    rows = []
    for i in range(n_rows):
        row = {}
        for c in cols:
            row[c] = clean_val(data[c][i])
        rows.append(row)
    return rows


def role_to_typ(roles_set):
    if 'EINSIN' in roles_set and 'KEINSIN' in roles_set:
        return 'Einschluss+Ausschluss'
    elif 'KEINSIN' in roles_set:
        return 'Ausschluss'
    elif 'EINSIN' in roles_set:
        return 'Einschluss'
    else:
        return 'Unbekannt'


def convert_ops_code(code):
    if not code or '-' in code:
        return code
    if len(code) <= 1:
        return code
    chapter = code[0]
    rest = code[1:]
    if len(rest) <= 3:
        return chapter + '-' + rest
    return chapter + '-' + rest[:3] + '.' + rest[3:]


def detect_code_type(list_name):
    name_upper = list_name.upper()
    if '_OPS' in name_upper:
        return 'ops'
    if '_ICD' in name_upper:
        return 'icd'
    if '_GOP' in name_upper:
        return 'gop'
    if '_PZN' in name_upper:
        return 'pzn'
    if '_DRG' in name_upper:
        return 'drg'
    if '_FACHGRUPPE' in name_upper or '_FACHABTEILUNG' in name_upper or '_PBNR' in name_upper:
        return 'sonstige'
    return 'sonstige'


def empty_code_type_block():
    return {'einschluss_listen': [], 'ausschluss_listen': [],
            'einschluss_codes_distinct': 0, 'ausschluss_codes_distinct': 0}


# ===================================================================
# QSF PARSING
# ===================================================================

def parse_qsf(qsf_mdb, year):
    print("=" * 60)
    print(f"PARSING QSF (Basisspezifikation) — {year}...")
    print("=" * 60)
    db = AccessParser(qsf_mdb)

    # In some MDB versions, Modul table has name/bezeichnung directly;
    # in others (e.g. 2025), ModulAusloeser is the primary source.
    ausloeser_rows = table_to_rows(db, 'ModulAusloeser')
    ops_liste_rows = table_to_rows(db, 'OPSListe')
    ops_wert_rows = table_to_rows(db, 'OPSWert')
    icd_liste_rows = table_to_rows(db, 'ICDListe')
    icd_wert_rows = table_to_rows(db, 'ICDWert')

    # EBM lists (GOP codes) — optional, not all MDBs have them
    ebm_liste_rows = []
    ebm_wert_rows = []
    try:
        ebm_liste_rows = table_to_rows(db, 'EBMListe')
        ebm_wert_rows = table_to_rows(db, 'EBMWert')
    except Exception:
        pass

    print(f"  Ausloeser: {len(ausloeser_rows)}")
    print(f"  OPSListe: {len(ops_liste_rows)}, OPSWert: {len(ops_wert_rows)}")
    print(f"  ICDListe: {len(icd_liste_rows)}, ICDWert: {len(icd_wert_rows)}")
    if ebm_liste_rows:
        print(f"  EBMListe: {len(ebm_liste_rows)}, EBMWert: {len(ebm_wert_rows)}")

    # Build module lookup from ModulAusloeser (works for all MDB versions)
    modul_id_to_name = {}
    modul_name_to_bez = {}
    for row in ausloeser_rows:
        if row.get('name'):
            modul_id_to_name[row.get('fkModul', row.get('idModulAusloeser', ''))] = row['name']
            modul_name_to_bez[row['name']] = row.get('bezeichnung', '')

    ops_list_id_to_name = {}
    ops_list_names = set()
    ops_list_bez = {}
    for row in ops_liste_rows:
        ops_list_id_to_name[row['idOPSListe']] = row['name']
        ops_list_names.add(row['name'])
        ops_list_bez[row['name']] = row['bezeichnung']

    icd_list_id_to_name = {}
    icd_list_names = set()
    icd_list_bez = {}
    for row in icd_liste_rows:
        icd_list_id_to_name[row['idICDListe']] = row['name']
        icd_list_names.add(row['name'])
        icd_list_bez[row['name']] = row['bezeichnung']

    ops_list_codes = defaultdict(list)
    for row in ops_wert_rows:
        list_name = ops_list_id_to_name.get(row['fkOPSListe'], '')
        if list_name and row['code']:
            ops_list_codes[list_name].append(row['code'])

    icd_list_codes = defaultdict(list)
    for row in icd_wert_rows:
        list_name = icd_list_id_to_name.get(row['fkICDListe'], '')
        if list_name and row['code']:
            icd_list_codes[list_name].append(row['code'])

    # EBM (GOP) lookups
    ebm_list_id_to_name = {}
    ebm_list_names = set()
    ebm_list_bez = {}
    for row in ebm_liste_rows:
        ebm_list_id_to_name[row['idEBMListe']] = row['name']
        ebm_list_names.add(row['name'])
        ebm_list_bez[row['name']] = row['bezeichnung']

    ebm_list_codes = defaultdict(list)
    for row in ebm_wert_rows:
        list_name = ebm_list_id_to_name.get(row['fkEBMListe'], '')
        if list_name and row['code']:
            ebm_list_codes[list_name].append(row['code'])

    # Parse filter conditions
    module_list_usage = defaultdict(lambda: {'ops_ein': [], 'ops_aus': [], 'icd_ein': [], 'icd_aus': [], 'gop_ein': [], 'gop_aus': []})
    ops_list_global_roles = defaultdict(set)
    icd_list_global_roles = defaultdict(set)
    ebm_list_global_roles = defaultdict(set)

    for row in ausloeser_rows:
        modul_name = row.get('name', '') or modul_id_to_name.get(row.get('fkModul', ''), '')
        bedingung = row.get('bedingung', '')
        if not bedingung or not modul_name:
            continue

        for match in re.finditer(r'PROZ\s+(EINSIN|KEINSIN)\s+([A-Za-z0-9_/]+)', bedingung):
            role, list_name = match.group(1), match.group(2)
            if list_name not in ops_list_names:
                continue
            ops_list_global_roles[list_name].add(role)
            target = module_list_usage[modul_name]['ops_ein' if role == 'EINSIN' else 'ops_aus']
            if list_name not in target:
                target.append(list_name)

        for match in re.finditer(r'DIAG\s+(EINSIN|KEINSIN)\s+([A-Za-z0-9_/]+)', bedingung):
            role, list_name = match.group(1), match.group(2)
            if list_name not in icd_list_names:
                continue
            icd_list_global_roles[list_name].add(role)
            target = module_list_usage[modul_name]['icd_ein' if role == 'EINSIN' else 'icd_aus']
            if list_name not in target:
                target.append(list_name)

        for match in re.finditer(r'(?<!PROZ\s)(?<!DIAG\s)(EINSIN|KEINSIN)\s+([A-Za-z0-9_/]+)', bedingung):
            role, list_name = match.group(1), match.group(2)
            prefix_start = max(0, match.start() - 10)
            prefix = bedingung[prefix_start:match.start()]
            if 'PROZ' in prefix or 'DIAG' in prefix:
                continue
            if list_name in icd_list_names:
                icd_list_global_roles[list_name].add(role)
                target = module_list_usage[modul_name]['icd_ein' if role == 'EINSIN' else 'icd_aus']
                if list_name not in target:
                    target.append(list_name)
            elif list_name in ops_list_names:
                ops_list_global_roles[list_name].add(role)
                target = module_list_usage[modul_name]['ops_ein' if role == 'EINSIN' else 'ops_aus']
                if list_name not in target:
                    target.append(list_name)

        for match in re.finditer(r'pruefeDiagPS\([^)]*\)', bedingung):
            func_call = match.group(0)
            for lmatch in re.finditer(r'([A-Za-z0-9_/]+)', func_call):
                list_name = lmatch.group(1)
                if list_name in icd_list_names:
                    icd_list_global_roles[list_name].add('EINSIN')
                    if list_name not in module_list_usage[modul_name]['icd_ein']:
                        module_list_usage[modul_name]['icd_ein'].append(list_name)

        for match in re.finditer(r'HDIAG\s+IN\s+([A-Za-z0-9_/]+)', bedingung):
            list_name = match.group(1)
            if list_name not in icd_list_names:
                continue
            prefix_start = max(0, match.start() - 12)
            prefix = bedingung[prefix_start:match.start()]
            role = 'KEINSIN' if 'NICHT' in prefix else 'EINSIN'
            icd_list_global_roles[list_name].add(role)
            target = module_list_usage[modul_name]['icd_ein' if role == 'EINSIN' else 'icd_aus']
            if list_name not in target:
                target.append(list_name)

        # EBM: EBM EINSIN/KEINSIN <list>
        for match in re.finditer(r'EBM\s+(EINSIN|KEINSIN)\s+([A-Za-z0-9_/]+)', bedingung):
            role, list_name = match.group(1), match.group(2)
            if list_name not in ebm_list_names:
                continue
            ebm_list_global_roles[list_name].add(role)
            target = module_list_usage[modul_name]['gop_ein' if role == 'EINSIN' else 'gop_aus']
            if list_name not in target:
                target.append(list_name)

    # Build QSF listen
    qsf_listen_ops = {}
    for name in ops_list_names:
        roles = ops_list_global_roles.get(name, set())
        qsf_listen_ops[name] = {
            'bezeichnung': ops_list_bez.get(name, ''),
            'typ': role_to_typ(roles),
            'anzahl_codes': len(ops_list_codes[name]),
            'codes': sorted(ops_list_codes[name]),
            'quelle': 'QSF',
            'kontext': 'Spezifikation',
        }

    qsf_listen_icd = {}
    for name in icd_list_names:
        roles = icd_list_global_roles.get(name, set())
        qsf_listen_icd[name] = {
            'bezeichnung': icd_list_bez.get(name, ''),
            'typ': role_to_typ(roles),
            'anzahl_codes': len(icd_list_codes[name]),
            'codes': sorted(icd_list_codes[name]),
            'quelle': 'QSF',
            'kontext': 'Spezifikation',
        }

    qsf_listen_gop = {}
    for name in ebm_list_names:
        roles = ebm_list_global_roles.get(name, set())
        qsf_listen_gop[name] = {
            'bezeichnung': ebm_list_bez.get(name, ''),
            'typ': role_to_typ(roles),
            'anzahl_codes': len(ebm_list_codes[name]),
            'codes': sorted(ebm_list_codes[name]),
            'quelle': 'QSF',
            'kontext': 'Spezifikation',
        }

    # Build QSF module output (from ausloeser_rows which have name/bezeichnung)
    qsf_module_output = {}
    for row in ausloeser_rows:
        name = row.get('name', '')
        if not name:
            continue
        usage = module_list_usage[name]
        ein_ops = set()
        for l in usage['ops_ein']:
            ein_ops.update(ops_list_codes[l])
        aus_ops = set()
        for l in usage['ops_aus']:
            aus_ops.update(ops_list_codes[l])
        ein_icd = set()
        for l in usage['icd_ein']:
            ein_icd.update(icd_list_codes[l])
        aus_icd = set()
        for l in usage['icd_aus']:
            aus_icd.update(icd_list_codes[l])

        ein_gop = set()
        for l in usage['gop_ein']:
            ein_gop.update(ebm_list_codes[l])
        aus_gop = set()
        for l in usage['gop_aus']:
            aus_gop.update(ebm_list_codes[l])

        m = {
            'bezeichnung': row.get('bezeichnung', ''),
            'verfahren': QSF_MODULE_VERFAHREN.get(name, ''),
            'quelle': 'QSF',
            'kontext': 'Spezifikation',
            'ops': {
                'einschluss_listen': usage['ops_ein'],
                'ausschluss_listen': usage['ops_aus'],
                'einschluss_codes_distinct': len(ein_ops),
                'ausschluss_codes_distinct': len(aus_ops),
            },
            'icd': {
                'einschluss_listen': usage['icd_ein'],
                'ausschluss_listen': usage['icd_aus'],
                'einschluss_codes_distinct': len(ein_icd),
                'ausschluss_codes_distinct': len(aus_icd),
            },
            'gop': {
                'einschluss_listen': usage['gop_ein'],
                'ausschluss_listen': usage['gop_aus'],
                'einschluss_codes_distinct': len(ein_gop),
                'ausschluss_codes_distinct': len(aus_gop),
            },
        }
        for ct in ['pzn', 'drg', 'sonstige']:
            m[ct] = empty_code_type_block()
        qsf_module_output[name] = m

    # Build QSF code index
    qsf_ops_codes = defaultdict(lambda: {
        'rollen': set(), 'listen': set(), 'module': set(), 'verfahren': set(),
        'verwendung': [], 'quelle': {'QSF'}, 'kontext': {'Spezifikation'}
    })
    qsf_icd_codes = defaultdict(lambda: {
        'rollen': set(), 'listen': set(), 'module': set(), 'verfahren': set(),
        'verwendung': [], 'quelle': {'QSF'}, 'kontext': {'Spezifikation'}
    })
    qsf_gop_codes = defaultdict(lambda: {
        'rollen': set(), 'listen': set(), 'module': set(), 'verfahren': set(),
        'verwendung': [], 'quelle': {'QSF'}, 'kontext': {'Spezifikation'}
    })

    for modul_name, usage in module_list_usage.items():
        verfahren = QSF_MODULE_VERFAHREN.get(modul_name, '')
        for liste_name in usage['ops_ein']:
            for code in ops_list_codes[liste_name]:
                cd = qsf_ops_codes[code]
                cd['rollen'].add('EINSIN')
                cd['listen'].add(liste_name)
                cd['module'].add(modul_name)
                if verfahren: cd['verfahren'].add(verfahren)
                cd['verwendung'].append({'verfahren': verfahren, 'modul': modul_name, 'liste': liste_name, 'rolle': 'EINSIN', 'quelle': 'QSF', 'kontext': 'Spezifikation'})
        for liste_name in usage['ops_aus']:
            for code in ops_list_codes[liste_name]:
                cd = qsf_ops_codes[code]
                cd['rollen'].add('KEINSIN')
                cd['listen'].add(liste_name)
                cd['module'].add(modul_name)
                if verfahren: cd['verfahren'].add(verfahren)
                cd['verwendung'].append({'verfahren': verfahren, 'modul': modul_name, 'liste': liste_name, 'rolle': 'KEINSIN', 'quelle': 'QSF', 'kontext': 'Spezifikation'})
        for liste_name in usage['icd_ein']:
            for code in icd_list_codes[liste_name]:
                cd = qsf_icd_codes[code]
                cd['rollen'].add('EINSIN')
                cd['listen'].add(liste_name)
                cd['module'].add(modul_name)
                if verfahren: cd['verfahren'].add(verfahren)
                cd['verwendung'].append({'verfahren': verfahren, 'modul': modul_name, 'liste': liste_name, 'rolle': 'EINSIN', 'quelle': 'QSF', 'kontext': 'Spezifikation'})
        for liste_name in usage['icd_aus']:
            for code in icd_list_codes[liste_name]:
                cd = qsf_icd_codes[code]
                cd['rollen'].add('KEINSIN')
                cd['listen'].add(liste_name)
                cd['module'].add(modul_name)
                if verfahren: cd['verfahren'].add(verfahren)
                cd['verwendung'].append({'verfahren': verfahren, 'modul': modul_name, 'liste': liste_name, 'rolle': 'KEINSIN', 'quelle': 'QSF', 'kontext': 'Spezifikation'})
        for liste_name in usage['gop_ein']:
            for code in ebm_list_codes[liste_name]:
                cd = qsf_gop_codes[code]
                cd['rollen'].add('EINSIN')
                cd['listen'].add(liste_name)
                cd['module'].add(modul_name)
                if verfahren: cd['verfahren'].add(verfahren)
                cd['verwendung'].append({'verfahren': verfahren, 'modul': modul_name, 'liste': liste_name, 'rolle': 'EINSIN', 'quelle': 'QSF', 'kontext': 'Spezifikation'})
        for liste_name in usage['gop_aus']:
            for code in ebm_list_codes[liste_name]:
                cd = qsf_gop_codes[code]
                cd['rollen'].add('KEINSIN')
                cd['listen'].add(liste_name)
                cd['module'].add(modul_name)
                if verfahren: cd['verfahren'].add(verfahren)
                cd['verwendung'].append({'verfahren': verfahren, 'modul': modul_name, 'liste': liste_name, 'rolle': 'KEINSIN', 'quelle': 'QSF', 'kontext': 'Spezifikation'})

    print(f"  QSF: {len(qsf_listen_ops)} OPS-Listen, {len(qsf_listen_icd)} ICD-Listen, {len(qsf_listen_gop)} GOP-Listen")
    print(f"  QSF: {len(qsf_ops_codes)} OPS-Codes, {len(qsf_icd_codes)} ICD-Codes, {len(qsf_gop_codes)} GOP-Codes")
    print(f"  QSF: {len(qsf_module_output)} Module")

    return {
        'listen_ops': qsf_listen_ops,
        'listen_icd': qsf_listen_icd,
        'listen_gop': qsf_listen_gop,
        'module': qsf_module_output,
        'ops_codes': qsf_ops_codes,
        'icd_codes': qsf_icd_codes,
        'gop_codes': qsf_gop_codes,
        'ops_list_codes': ops_list_codes,
        'icd_list_codes': icd_list_codes,
        'ebm_list_codes': ebm_list_codes,
        'module_list_usage': module_list_usage,
    }


# ===================================================================
# SDAT PARSING
# ===================================================================

def parse_sdat(sdat_mdb, year, qsf_module_names):
    print("\n" + "=" * 60)
    print(f"PARSING SDAT (Sozialdaten) — {year}...")
    print("=" * 60)
    db = AccessParser(sdat_mdb)

    sdat_modules = table_to_rows(db, 'Modul')
    sdat_filter_lists = table_to_rows(db, 'FilterListe')
    sdat_filter_module = table_to_rows(db, 'FilterListeModul')
    sdat_filter_values = table_to_rows(db, 'FilterListeWert')
    sdat_mod_ej = table_to_rows(db, 'ModulErfassungsjahr')

    print(f"  Modul: {len(sdat_modules)}, FilterListe: {len(sdat_filter_lists)}")
    print(f"  FilterListeModul: {len(sdat_filter_module)}, FilterListeWert: {len(sdat_filter_values)}")
    print(f"  ModulErfassungsjahr: {len(sdat_mod_ej)}")

    sdat_mod_id_to_name = {}
    sdat_mod_bez = {}
    sdat_mod_richtlinie = {}
    for row in sdat_modules:
        sdat_mod_id_to_name[row['id']] = row['name']
        sdat_mod_bez[row['name']] = row['bezeichnung']
        sdat_mod_richtlinie[row['name']] = row.get('richtlinie', '')

    sdat_list_id_to_name = {}
    sdat_list_bez = {}
    sdat_list_all_names = set()
    for row in sdat_filter_lists:
        sdat_list_id_to_name[row['id']] = row['name']
        sdat_list_bez[row['name']] = row['bezeichnung']
        sdat_list_all_names.add(row['name'])

    sdat_list_to_modules = defaultdict(set)
    for row in sdat_filter_module:
        list_name = sdat_list_id_to_name.get(row['fkFilterListe'], '')
        mod_name = sdat_mod_id_to_name.get(row['fkModul'], '')
        if list_name and mod_name and mod_name not in SDAT_SKIP_MODULES:
            sdat_list_to_modules[list_name].add(mod_name)

    sdat_list_codes = defaultdict(list)
    for row in sdat_filter_values:
        list_name = sdat_list_id_to_name.get(row['fkListe'], '')
        if not list_name or not row['code']:
            continue
        if list_name.startswith('BSP_'):
            continue
        code = row['code']
        code_type = detect_code_type(list_name)
        if code_type == 'ops':
            code = convert_ops_code(code)
        sdat_list_codes[list_name].append(code)

    # Parse filter expressions — use year as erfassungsjahr
    sdat_list_roles = defaultdict(set)
    sdat_list_stages = defaultdict(set)
    sdat_mod_usage = defaultdict(lambda: {ct: {'ein': [], 'aus': []} for ct in CODE_TYPES})

    ej_count = 0
    for row in sdat_mod_ej:
        mod_name = sdat_mod_id_to_name.get(row['fkModul'], '')
        if not mod_name or mod_name in SDAT_SKIP_MODULES:
            continue
        if row.get('erfassungsjahr', '') != str(year):
            continue
        ej_count += 1

        for stage_label, field_name in [('Patientenfilter', 'patientenFilter'),
                                         ('Leistungsfilter', 'leistungsMedikationsFilter')]:
            expr = row.get(field_name, '')
            if not expr:
                continue
            for match in re.finditer(r'(EINSIN|KEINSIN)\s+Codeliste\.([A-Za-z0-9_]+)', expr):
                role = match.group(1)
                list_name = match.group(2)
                if list_name not in sdat_list_all_names:
                    continue
                code_type = detect_code_type(list_name)
                bucket = code_type if code_type in CODE_TYPES else 'sonstige'
                sdat_list_roles[list_name].add(role)
                sdat_list_stages[list_name].add(stage_label)
                usage = sdat_mod_usage[mod_name][bucket]
                target = usage['ein'] if role == 'EINSIN' else usage['aus']
                if list_name not in target:
                    target.append(list_name)

    print(f"  Erfassungsjahr-{year} Eintraege: {ej_count}")
    print(f"  Listen mit Rolle aus Filterausdruecken: {len(sdat_list_roles)}")

    # Handle lists without expressions — name-based heuristics
    for list_name, mods in sdat_list_to_modules.items():
        if list_name.startswith('BSP_'):
            continue
        if list_name not in sdat_list_roles:
            name_upper = list_name.upper()
            derived_role = 'KEINSIN' if (name_upper.endswith('_EX') or '_EX_' in name_upper) else 'EINSIN'
            sdat_list_roles[list_name].add(derived_role)
            if '_INDEX' in name_upper:
                sdat_list_stages[list_name].add('Patientenfilter')
            elif any(s in name_upper for s in ['_KOMPL', '_RA', '_KOMORB']):
                sdat_list_stages[list_name].add('Leistungsfilter')
            code_type = detect_code_type(list_name)
            bucket = code_type if code_type in CODE_TYPES else 'sonstige'
            for mod_name in mods:
                if mod_name in SDAT_SKIP_MODULES:
                    continue
                usage = sdat_mod_usage[mod_name][bucket]
                target = usage['ein'] if derived_role == 'EINSIN' else usage['aus']
                if list_name not in target:
                    target.append(list_name)

    # Handle module name collisions
    sdat_display_name = {}
    for mod_name in sdat_mod_bez:
        if mod_name in SDAT_SKIP_MODULES:
            continue
        sdat_display_name[mod_name] = (mod_name + ' (SDAT)') if mod_name in qsf_module_names else mod_name

    # Build SDAT listen
    sdat_listen = {ct: {} for ct in CODE_TYPES}
    for list_name in sdat_list_all_names:
        if list_name.startswith('BSP_'):
            continue
        code_type = detect_code_type(list_name)
        bucket = code_type if code_type in CODE_TYPES else 'sonstige'
        roles = sdat_list_roles.get(list_name, set())
        stages = sdat_list_stages.get(list_name, set())
        sdat_listen[bucket][list_name] = {
            'bezeichnung': sdat_list_bez.get(list_name, ''),
            'typ': role_to_typ(roles),
            'anzahl_codes': len(sdat_list_codes[list_name]),
            'codes': sorted(sdat_list_codes[list_name]),
            'quelle': 'SDAT',
            'kontext': 'Spezifikation',
            'filterstufe': ' + '.join(sorted(stages)) if stages else '',
        }

    for ct in CODE_TYPES:
        if sdat_listen[ct]:
            print(f"  SDAT {ct.upper()}-Listen: {len(sdat_listen[ct])}")

    # Build SDAT module output
    sdat_module_output = {}
    for mod_name in sdat_mod_bez:
        if mod_name in SDAT_SKIP_MODULES:
            continue
        display = sdat_display_name[mod_name]
        verfahren = SDAT_MODULE_VERFAHREN.get(mod_name, '')
        m = {
            'bezeichnung': sdat_mod_bez[mod_name],
            'verfahren': verfahren,
            'quelle': 'SDAT',
            'kontext': 'Spezifikation',
            'richtlinie': sdat_mod_richtlinie.get(mod_name, ''),
        }
        usage = sdat_mod_usage[mod_name]
        for ct in CODE_TYPES:
            ein_codes = set()
            for l in usage[ct]['ein']:
                ein_codes.update(sdat_list_codes[l])
            aus_codes = set()
            for l in usage[ct]['aus']:
                aus_codes.update(sdat_list_codes[l])
            m[ct] = {
                'einschluss_listen': usage[ct]['ein'],
                'ausschluss_listen': usage[ct]['aus'],
                'einschluss_codes_distinct': len(ein_codes),
                'ausschluss_codes_distinct': len(aus_codes),
            }
        sdat_module_output[display] = m

    # Build SDAT code index
    sdat_codes = {ct: defaultdict(lambda: {
        'rollen': set(), 'listen': set(), 'module': set(), 'verfahren': set(),
        'verwendung': [], 'quelle': {'SDAT'}, 'kontext': {'Spezifikation'}
    }) for ct in CODE_TYPES}

    for mod_name in sdat_mod_bez:
        if mod_name in SDAT_SKIP_MODULES:
            continue
        display = sdat_display_name[mod_name]
        verfahren = SDAT_MODULE_VERFAHREN.get(mod_name, '')
        usage = sdat_mod_usage[mod_name]
        for ct in CODE_TYPES:
            for liste_name in usage[ct]['ein']:
                for code in sdat_list_codes[liste_name]:
                    cd = sdat_codes[ct][code]
                    cd['rollen'].add('EINSIN')
                    cd['listen'].add(liste_name)
                    cd['module'].add(display)
                    if verfahren: cd['verfahren'].add(verfahren)
                    cd['verwendung'].append({'verfahren': verfahren, 'modul': display, 'liste': liste_name, 'rolle': 'EINSIN', 'quelle': 'SDAT', 'kontext': 'Spezifikation'})
            for liste_name in usage[ct]['aus']:
                for code in sdat_list_codes[liste_name]:
                    cd = sdat_codes[ct][code]
                    cd['rollen'].add('KEINSIN')
                    cd['listen'].add(liste_name)
                    cd['module'].add(display)
                    if verfahren: cd['verfahren'].add(verfahren)
                    cd['verwendung'].append({'verfahren': verfahren, 'modul': display, 'liste': liste_name, 'rolle': 'KEINSIN', 'quelle': 'SDAT', 'kontext': 'Spezifikation'})

    for ct in CODE_TYPES:
        if sdat_codes[ct]:
            print(f"  SDAT {ct.upper()}-Codes: {len(sdat_codes[ct])}")

    return {
        'listen': sdat_listen,
        'module': sdat_module_output,
        'codes': sdat_codes,
        'display_name': sdat_display_name,
    }


# ===================================================================
# QIDB (Rechenregellisten) PARSING
# ===================================================================

def parse_qidb(csv_path, year):
    print("\n" + "=" * 60)
    print(f"PARSING QIDB Rechenregellisten — {year}...")
    print("=" * 60)

    with open(csv_path, encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"  CSV-Zeilen: {len(rows)}")

    # Group by list
    qidb_listen_data = defaultdict(lambda: {
        'codes': [], 'typ': '', 'beschreibung': '', 'pdf': '', 'csv_verfahren': ''
    })

    for row in rows:
        ln = row['listenname']
        code = row['code_norm']
        if not ln or not code:
            continue
        ld = qidb_listen_data[ln]
        ld['codes'].append(code)
        if not ld['typ']:
            ld['typ'] = row['typ']
        if not ld['beschreibung']:
            ld['beschreibung'] = row['beschreibung']
        if not ld['pdf']:
            ld['pdf'] = row['pdf_name']
            # Extract CSV-Verfahren from PDF name: DeQS_{Verfahren}_EJ-...
            parts = row['pdf_name'].split('_')
            if len(parts) > 1:
                ld['csv_verfahren'] = parts[1]

    print(f"  Listen: {len(qidb_listen_data)}")

    # Build output structures
    qidb_listen = {ct: {} for ct in CODE_TYPES}
    qidb_codes = {ct: defaultdict(lambda: {
        'rollen': set(), 'listen': set(), 'module': set(), 'verfahren': set(),
        'verwendung': [], 'quelle': {'QIDB'}, 'kontext': {'Rechenregel'}
    }) for ct in CODE_TYPES}

    # Track verfahren for module-like structures
    qidb_verfahren_listen = defaultdict(list)  # qs_verfahren -> [list_names]

    for list_name, ld in qidb_listen_data.items():
        code_type = QIDB_TYP_MAP.get(ld['typ'], 'sonstige')
        csv_verf = ld['csv_verfahren']
        qs_verfahren = QIDB_VERFAHREN_MAP.get(csv_verf, '')

        if not qs_verfahren and csv_verf:
            # Try to auto-map unknown verfahren
            print(f"  WARNUNG: Kein Mapping fuer CSV-Verfahren '{csv_verf}' — Liste '{list_name}' wird uebersprungen")
            continue

        codes = sorted(set(ld['codes']))
        qidb_listen[code_type][list_name] = {
            'bezeichnung': ld['beschreibung'],
            'typ': '–',  # RR lists have no Einschluss/Ausschluss role
            'anzahl_codes': len(codes),
            'codes': codes,
            'quelle': 'QIDB',
            'kontext': 'Rechenregel',
            'verfahren': qs_verfahren,
        }

        qidb_verfahren_listen[qs_verfahren].append(list_name)

        # Build code index
        for code in codes:
            cd = qidb_codes[code_type][code]
            cd['listen'].add(list_name)
            if qs_verfahren:
                cd['verfahren'].add(qs_verfahren)
            cd['verwendung'].append({
                'verfahren': qs_verfahren,
                'modul': '–',
                'liste': list_name,
                'rolle': '–',
                'quelle': 'QIDB',
                'kontext': 'Rechenregel',
            })

    for ct in CODE_TYPES:
        if qidb_listen[ct]:
            print(f"  QIDB {ct.upper()}-Listen: {len(qidb_listen[ct])}")
        if qidb_codes[ct]:
            print(f"  QIDB {ct.upper()}-Codes: {len(qidb_codes[ct])}")

    print(f"  Verfahren mit RR-Listen: {len(qidb_verfahren_listen)}")

    return {
        'listen': qidb_listen,
        'codes': qidb_codes,
        'verfahren_listen': dict(qidb_verfahren_listen),
    }


# ===================================================================
# MERGE & OUTPUT
# ===================================================================

def merge_and_build(qsf, sdat, qidb, year):
    print("\n" + "=" * 60)
    print("MERGING QSF + SDAT + QIDB...")
    print("=" * 60)

    # Merge listen
    merged_listen = {ct: {} for ct in CODE_TYPES}
    merged_listen['ops'].update(qsf['listen_ops'])
    merged_listen['icd'].update(qsf['listen_icd'])
    merged_listen['gop'].update(qsf.get('listen_gop', {}))
    for ct in CODE_TYPES:
        merged_listen[ct].update(sdat['listen'][ct])
        merged_listen[ct].update(qidb['listen'][ct])

    for ct in CODE_TYPES:
        if merged_listen[ct]:
            print(f"  Merged {ct.upper()}-Listen: {len(merged_listen[ct])}")

    # Merge modules (only QSF + SDAT have modules; QIDB does not)
    merged_modules = {}
    merged_modules.update(qsf['module'])
    merged_modules.update(sdat['module'])
    print(f"  Merged Module: {len(merged_modules)}")

    # Merge codes
    merged_codes = {ct: {} for ct in CODE_TYPES}
    for code, data in qsf['ops_codes'].items():
        merged_codes['ops'][code] = data
    for code, data in qsf['icd_codes'].items():
        merged_codes['icd'][code] = data
    for code, data in qsf.get('gop_codes', {}).items():
        merged_codes['gop'][code] = data

    # Merge SDAT
    for ct in CODE_TYPES:
        for code, sdat_data in sdat['codes'][ct].items():
            if code in merged_codes[ct]:
                existing = merged_codes[ct][code]
                existing['rollen'].update(sdat_data['rollen'])
                existing['listen'].update(sdat_data['listen'])
                existing['module'].update(sdat_data['module'])
                existing['verfahren'].update(sdat_data['verfahren'])
                existing['verwendung'].extend(sdat_data['verwendung'])
                existing['quelle'].update(sdat_data['quelle'])
                existing['kontext'].update(sdat_data['kontext'])
            else:
                merged_codes[ct][code] = sdat_data

    # Merge QIDB
    for ct in CODE_TYPES:
        for code, qidb_data in qidb['codes'][ct].items():
            if code in merged_codes[ct]:
                existing = merged_codes[ct][code]
                existing['rollen'].update(qidb_data['rollen'])
                existing['listen'].update(qidb_data['listen'])
                existing['module'].update(qidb_data['module'])
                existing['verfahren'].update(qidb_data['verfahren'])
                existing['verwendung'].extend(qidb_data['verwendung'])
                existing['quelle'].update(qidb_data['quelle'])
                existing['kontext'].update(qidb_data['kontext'])
            else:
                merged_codes[ct][code] = qidb_data

    for ct in CODE_TYPES:
        if merged_codes[ct]:
            print(f"  Merged {ct.upper()}-Codes: {len(merged_codes[ct])}")

    # Build Verfahren from merged modules
    all_verfahren_modules = defaultdict(list)
    for mod_name, mod_data in merged_modules.items():
        verf = mod_data.get('verfahren', '')
        if verf and mod_name not in all_verfahren_modules[verf]:
            all_verfahren_modules[verf].append(mod_name)
    # Add QIDB-only verfahren (e.g., QS APSY)
    for qs_verf in qidb['verfahren_listen']:
        if qs_verf not in all_verfahren_modules:
            all_verfahren_modules[qs_verf] = []

    verfahren_output = {}
    for v_name, v_module_list in sorted(all_verfahren_modules.items()):
        v_data = {'module': v_module_list}
        for ct in CODE_TYPES:
            ein_codes = set()
            aus_codes = set()
            rr_codes = set()
            for mod_display in v_module_list:
                if mod_display in merged_modules:
                    mod_data = merged_modules[mod_display]
                    if ct in mod_data:
                        for l in mod_data[ct].get('einschluss_listen', []):
                            if l in merged_listen[ct]:
                                ein_codes.update(merged_listen[ct][l].get('codes', []))
                        for l in mod_data[ct].get('ausschluss_listen', []):
                            if l in merged_listen[ct]:
                                aus_codes.update(merged_listen[ct][l].get('codes', []))
            # Count QIDB codes for this Verfahren
            for list_name in qidb['verfahren_listen'].get(v_name, []):
                if list_name in merged_listen[ct]:
                    rr_codes.update(merged_listen[ct][list_name].get('codes', []))

            v_data[f'{ct}_einschluss_distinct'] = len(ein_codes)
            v_data[f'{ct}_ausschluss_distinct'] = len(aus_codes)
            v_data[f'{ct}_rechenregel_distinct'] = len(rr_codes)

        # Count RR listen for this Verfahren
        v_data['rr_listen'] = len(qidb['verfahren_listen'].get(v_name, []))

        verfahren_output[v_name] = v_data

    print(f"  Verfahren: {len(verfahren_output)}")

    # Count overlap: codes in both Spezifikation AND Rechenregel
    overlap_stats = {}
    for ct in CODE_TYPES:
        spez_codes = set()
        rr_codes = set()
        for code, data in merged_codes[ct].items():
            kontexte = data.get('kontext', set())
            if 'Spezifikation' in kontexte:
                spez_codes.add(code)
            if 'Rechenregel' in kontexte:
                rr_codes.add(code)
        overlap = spez_codes & rr_codes
        if spez_codes or rr_codes:
            overlap_stats[ct] = {
                'nur_spezifikation': len(spez_codes - rr_codes),
                'nur_rechenregel': len(rr_codes - spez_codes),
                'beide': len(overlap),
            }

    # Serialize codes
    def serialize_codes(codes_dict):
        result = {}
        for code, data in codes_dict.items():
            result[code] = {
                'rollen': sorted([r for r in data['rollen'] if r != '–']),
                'anzahl_listen': len(data['listen']),
                'anzahl_module': len([m for m in data['module'] if m != '–']),
                'anzahl_verfahren': len(data['verfahren']),
                'listen': sorted(list(data['listen'])),
                'module': sorted([m for m in data['module'] if m != '–']),
                'verfahren': sorted(list(data['verfahren'])),
                'verwendung': data['verwendung'],
                'quelle': sorted(list(data.get('quelle', set()))),
                'kontext': sorted(list(data.get('kontext', set()))),
                'katalog': {'bezeichnung': '', f'gueltig_{year}': None, 'letzte_gueltigkeit': ''},
            }
        return result

    serialized_codes = {ct: serialize_codes(merged_codes[ct]) for ct in CODE_TYPES}

    # Statistics
    stats = {
        'verfahren_gesamt': len(verfahren_output),
        'module_gesamt': len(merged_modules),
        'module_qsf': sum(1 for m in merged_modules.values() if m['quelle'] == 'QSF'),
        'module_sdat': sum(1 for m in merged_modules.values() if m['quelle'] == 'SDAT'),
    }

    for ct in CODE_TYPES:
        ct_codes = serialized_codes[ct]
        ct_listen = merged_listen[ct]
        stats[f'{ct}_codes_in_filtern'] = len(ct_codes)
        stats[f'{ct}_codes_nur_spezifikation'] = sum(1 for c in ct_codes.values() if c['kontext'] == ['Spezifikation'])
        stats[f'{ct}_codes_nur_rechenregel'] = sum(1 for c in ct_codes.values() if c['kontext'] == ['Rechenregel'])
        stats[f'{ct}_codes_beide'] = sum(1 for c in ct_codes.values() if 'Spezifikation' in c['kontext'] and 'Rechenregel' in c['kontext'])
        stats[f'{ct}_listen_gesamt'] = len(ct_listen)
        stats[f'{ct}_listen_spezifikation'] = sum(1 for l in ct_listen.values() if l.get('kontext') == 'Spezifikation')
        stats[f'{ct}_listen_rechenregel'] = sum(1 for l in ct_listen.values() if l.get('kontext') == 'Rechenregel')
        stats[f'{ct}_listen_qsf'] = sum(1 for l in ct_listen.values() if l.get('quelle') == 'QSF')
        stats[f'{ct}_listen_sdat'] = sum(1 for l in ct_listen.values() if l.get('quelle') == 'SDAT')
        stats[f'{ct}_listen_qidb'] = sum(1 for l in ct_listen.values() if l.get('quelle') == 'QIDB')

    dashboard = {
        'meta': {
            'version': '1.0',
            'jahr': year,
            'quellen': [
                f'IQTIG Basisspezifikation {year} (QSF)',
                f'IQTIG SDAT {year} (Sozialdaten bei den Krankenkassen)',
                f'IQTIG QIDB-RR-P {year} (Rechenregellisten)',
            ],
            'statistik': stats,
            'ueberschneidung': overlap_stats,
        },
        'verfahren': verfahren_output,
        'module': merged_modules,
        'listen': merged_listen,
        'codes': serialized_codes,
    }

    # Print summary
    print(f"\n{'=' * 60}")
    print("STATISTIK")
    print(f"{'=' * 60}")
    print(f"  Verfahren: {stats['verfahren_gesamt']}")
    print(f"  Module: {stats['module_gesamt']} (QSF: {stats['module_qsf']}, SDAT: {stats['module_sdat']})")
    for ct in CODE_TYPES:
        c = stats.get(f'{ct}_codes_in_filtern', 0)
        l = stats.get(f'{ct}_listen_gesamt', 0)
        if c > 0 or l > 0:
            lq = stats.get(f'{ct}_listen_qsf', 0)
            ls = stats.get(f'{ct}_listen_sdat', 0)
            lr = stats.get(f'{ct}_listen_qidb', 0)
            cs = stats.get(f'{ct}_codes_nur_spezifikation', 0)
            cr = stats.get(f'{ct}_codes_nur_rechenregel', 0)
            cb = stats.get(f'{ct}_codes_beide', 0)
            print(f"  {ct.upper()}: {c} Codes ({cs} Spez, {cr} RR, {cb} beide), {l} Listen (QSF: {lq}, SDAT: {ls}, QIDB: {lr})")

    if overlap_stats:
        print(f"\n  Ueberschneidung Spez/RR:")
        for ct, ov in overlap_stats.items():
            if ov['beide'] > 0:
                print(f"    {ct.upper()}: {ov['beide']} Codes in beiden Kontexten")

    return dashboard


# ===================================================================
# MAIN
# ===================================================================

def find_files(year):
    """Find source files for a given year."""
    data_dir = os.path.join(REPO_ROOT, "source-data", str(year))
    if not os.path.isdir(data_dir):
        raise FileNotFoundError(f"Verzeichnis nicht gefunden: {data_dir}")

    qsf_mdb = None
    sdat_mdb = None
    qidb_csv = None

    for f in os.listdir(data_dir):
        fp = os.path.join(data_dir, f)
        fl = f.lower()
        if fl.endswith('.mdb') and 'qsf' in fl:
            qsf_mdb = fp
        elif fl.endswith('.mdb') and 'sdat' in fl:
            sdat_mdb = fp
        elif fl.endswith('.csv') and 'qidb' in fl:
            qidb_csv = fp

    if not qsf_mdb:
        raise FileNotFoundError(f"Keine QSF-MDB in {data_dir} gefunden")
    if not sdat_mdb:
        raise FileNotFoundError(f"Keine SDAT-MDB in {data_dir} gefunden")

    return qsf_mdb, sdat_mdb, qidb_csv


def main():
    parser = argparse.ArgumentParser(description='Build QS Code Dashboard JSON')
    parser.add_argument('--year', type=int, default=2025, help='Erfassungsjahr (default: 2025)')
    args = parser.parse_args()
    year = args.year

    print(f"Building dashboard for year {year}...")
    qsf_mdb, sdat_mdb, qidb_csv = find_files(year)
    print(f"  QSF: {qsf_mdb}")
    print(f"  SDAT: {sdat_mdb}")
    print(f"  QIDB: {qidb_csv or '(nicht vorhanden)'}")

    qsf = parse_qsf(qsf_mdb, year)
    sdat = parse_sdat(sdat_mdb, year, qsf_module_names=set(qsf['module'].keys()))

    # QIDB is optional
    if qidb_csv:
        qidb = parse_qidb(qidb_csv, year)
    else:
        print(f"\n  WARNUNG: Keine QIDB-CSV fuer {year} — Rechenregellisten werden uebersprungen")
        qidb = {
            'listen': {ct: {} for ct in CODE_TYPES},
            'codes': {ct: {} for ct in CODE_TYPES},
            'verfahren_listen': {},
        }

    dashboard = merge_and_build(qsf, sdat, qidb, year)

    output_path = os.path.join(REPO_ROOT, "public", "data", f"dashboard_{year}.json")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    print(f"\nWriting {output_path}...")
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(dashboard, f, ensure_ascii=False, separators=(',', ':'))

    fsize = os.path.getsize(output_path) / (1024 * 1024)
    print(f"Done! Size: {fsize:.1f} MB")


if __name__ == '__main__':
    main()
