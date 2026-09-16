#!/usr/bin/env python3
"""Extract the vocabulary sheet into the Job JSON shape semanticore loads.

Usage: python3 export-vocabulary.py [sheet.html] [out.json]
Defaults to 2026-09-15-vocabulary.html beside this script and the matching .json.
"""
import html, json, re, sys
from pathlib import Path

here = Path(__file__).parent
src_path = Path(sys.argv[1]) if len(sys.argv) > 1 else here / '2026-09-15-vocabulary.html'
out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else src_path.with_suffix('.json')
src = src_path.read_text()


def unmark(h):
    """Substitution spans become the spec's inline marks; other HTML stays."""
    h = re.sub(r'<(?:span|a)[^>]*class="keep"[^>]*>([^<]+)</(?:span|a)>', lambda m: '\\' + m.group(1), h)
    h = re.sub(r'<(?:span|a)[^>]*class="vb"[^>]*data-v="v-(\w+)"[^>]*>([^<]+)</(?:span|a)>', lambda m: m.group(2) + '@v', h)
    h = re.sub(r'<(?:span|a)[^>]*class="r"[^>]*data-r="(\w+)"[^>]*>([^<]+)</(?:span|a)>', lambda m: m.group(2), h)
    return h.strip()


def text(h):
    return html.unescape(re.sub(r'<[^>]+>', '', h)).strip()


roles, verbs = [], []
for m in re.finditer(r'<section class="term([^"]*)" id="t-([\w-]+)" data-term="[\w-]+">(.*?)</section>', src, re.S):
    cls, key, body = m.group(1), m.group(2), m.group(3)
    kind = 'fixed' if 'fixed' in cls else 'operation' if ' op' in cls else 'verb' if 'verb' in cls else 'noun'
    title = text(re.search(r'<h3>(.*?)</h3>', body, re.S).group(1))
    was = text(re.search(r'was <code>(.*?)</code>', body).group(1))
    g = re.search(r'<div class="gloss"><p>(.*?)</p>(?:<ul>(.*?)</ul>)?</div>', body, re.S)
    gloss = {'lead': unmark(g.group(1)), 'items': [unmark(i) for i in re.findall(r'<li>(.*?)</li>', g.group(2) or '', re.S)]}
    groups = []
    for fm in re.finditer(r'<div class="field">([^<]+)</div><div class="words">(.*?)</div>', body, re.S):
        field, words = fm.group(1), fm.group(2)
        if field in ('keep', 'write-in'):
            continue
        groups.append({'field': field, 'words': [{'word': w, 'star': bool(st)} for st, w in re.findall(r'<button class="w( star)?">([^<]+)</button>', words)]})
    entry = {'key': key[2:] if key.startswith('v-') else key, 'title': title, 'was': was, 'kind': kind, 'gloss': gloss}
    if kind != 'fixed':
        entry['groups'] = groups
        n = sum(len(g['words']) for g in groups)
        if n != 20:
            sys.exit(f'{key}: {n} words, expected 20')
    (verbs if kind in ('verb', 'operation') else roles).append(entry)

sigs = {}
for line in re.findall(r'<p class="api">(.*?)</p>', src, re.S):
    for m in re.finditer(r'<code>(?:([\w.]+)\.)?<span class="vb" data-v="v-(\w+)">\w+</span>(\([^)]*\))</code>', line):
        sigs[m.group(2)] = (m.group(1) + '.' if m.group(1) else '') + m.group(2) + m.group(3)
for v in verbs:
    v['signature'] = sigs.get(v['key'], v['key'] + '()')

desc = {}
for m in re.finditer(r'<tr><td class="mine" data-for="([\w-]+)"></td><td class="role">(.*?)</td><td class="now">', src):
    desc[m.group(1)[2:] if m.group(1).startswith('v-') else m.group(1)] = text(m.group(2))
desc['phase'] = 'place in the pass'
for r in roles + verbs:
    r['description'] = desc.get(r['key'], r['title'])

hdr = re.search(r'<table class="vocab">\s*<tr>(.*?)</tr>', src, re.S).group(1)
fields = [text(h) for h in re.findall(r'<th>(.*?)</th>', hdr)][2:]
sets = []
for m in re.finditer(r'<tr data-role="(\w+)"><td class="mine"[^>]*></td><td class="role">([^<]+)</td>((?:<td>[^<]*</td>)+)</tr>', src):
    cells = re.findall(r'<td>([^<]*)</td>', m.group(3))
    sets.append({'role': m.group(1), 'words': {f: (c if c != '—' else None) for f, c in zip(fields, cells)}})

raw = re.search(r"var DEFAULTS = (\{[^}]*\});", src).group(1)
defaults = dict(re.findall(r"(\w+):\s*'([^']+)'", raw))

relations = [{'formula': unmark(f), 'gloss': unmark(g)} for f, g in re.findall(r'<div class="f">(.*?)</div><div class="g">(.*?)</div>', src, re.S)]
algebra = [{'key': text(k), 'body': unmark(v)} for k, v in re.findall(r'<div class="k">(.*?)</div>\s*<div class="v">(.*?)</div>', src, re.S)]


def section(id_):
    m = re.search(r'<h2 id="%s">(.*?)</h2>(.*?)(?=<h2 |<section |<h3 id=|</main>)' % id_, src, re.S)
    return {'title': text(m.group(1)), 'body': unmark(m.group(2))} if m else None


job = {
    'title': text(re.search(r'<title>(.*?)</title>', src).group(1)),
    'subject': 'blits, the effects-schema package: the roles of its schema, the verbs of its API, and the operations of its channels',
    'status': text(re.search(r'<span class="status">(.*?)</span>', src).group(1)),
    'date': '2026-09-15',
    'fields': fields,
    'roles': roles,
    'verbs': verbs,
    'sets': sets,
    'defaults': defaults,
    'relations': relations,
    'algebra': algebra,
    'prose': {k: section(v) for k, v in [('why', 'why'), ('relations', 'relations'), ('algebraIntro', 'algebra'), ('sets', 'sets'), ('domain', 'domain'), ('recommendation', 'take')]},
}
out_path.write_text(json.dumps(job, ensure_ascii=False, indent=2) + '\n')
print(f'{out_path.name}: {len(roles)} roles, {len(verbs)} verbs, {len(sets)} sets, {len(relations)} relations')
