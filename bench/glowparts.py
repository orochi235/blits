#!/usr/bin/env python3
# Splits a glow's frame between its parts: copies dist/ once per variant with one part of the lane's
# weight-signal read stubbed out, and runs rows over every copy, alternating the order each round.
# Matches compiled text, so a variant whose text moved fails its assert rather than measure nothing.
#   npx tsc -b && python3 bench/glowparts.py <rounds> <rows...>      (from the repo root)
import os, shutil, subprocess, sys, tempfile

root = os.getcwd()
rounds = int(sys.argv[1])
rows = sys.argv[2:]
var = tempfile.mkdtemp()


def edit(path, old, new):
    s = open(path).read()
    assert s.count(old) == 1, (path, old, s.count(old))
    open(path, 'w').write(s.replace(old, new))


variants = {
    'V0-base': [],
    # The bench's signal returning 0 without its arithmetic, and with sqrt in place of hypot.
    'V1-signal0': [('bench/frame.mjs', 'const near = (s) => Math.max(', 'const near = (s) => 0; const near0 = (s) => Math.max(')],
    'V7-sqrt': [('bench/frame.mjs', 'const near = (s) => Math.max(0, 1 - Math.hypot(s.x - pointer.x, s.y - pointer.y) / RADIUS);', 'const near = (s) => { const dx = s.x - pointer.x; const dy = s.y - pointer.y; return Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / RADIUS); };')],
    # The lane's signal read without `base` around the call, without prime, without the signal at all.
    'V8-barebase': [('dist/hosts.js', 'const base = mix.base(voice, subject, mix.now, held, slot);', 'const base = voice.spec.weight(subject, voice.setting);')],
    'V4-noprime': [('dist/hosts.js', 'mix.prime(voice, held);\n            const kept', 'const kept')],
    'V6-nobase': [('dist/hosts.js', 'const base = mix.base(voice, subject, mix.now, held, slot);', 'const base = 0;')],
    'V3-nosignal': [('dist/hosts.js', 'signal: (voice, subject, held, slot) => {', 'signal: (voice, subject, held, slot) => {\n            mix.lanes.arg[0] = 0; return;')],
    # A subject at weight 0 returning before `call`; a signalled voice's lane read skipped outright.
    'V5-nocall': [('dist/fill.js', "    arg[1 /* Arg.ELAPSED */] = elapsed;\n    arg[4 /* Arg.DELAY */] = delay;", "    if (!(w > 0)) return false;\n    arg[1 /* Arg.ELAPSED */] = elapsed;\n    arg[4 /* Arg.DELAY */] = delay;")],
    'V2-noweigh': [('dist/fill.js', "if (typeof voice.spec.weight === 'function') {\n        arg[1 /* Arg.ELAPSED */]", "if (typeof voice.spec.weight === 'function') {\n        return false;\n        arg[1 /* Arg.ELAPSED */]")],
}


def build(name, edits):
    d = os.path.join(var, name)
    os.makedirs(os.path.join(d, 'bench'))
    shutil.copytree(os.path.join(root, 'dist'), os.path.join(d, 'dist'))
    shutil.copy(os.path.join(root, 'bench/frame.mjs'), os.path.join(d, 'bench/frame.mjs'))
    os.symlink(os.path.join(root, 'node_modules'), os.path.join(d, 'node_modules'))
    shutil.copy(os.path.join(root, 'package.json'), os.path.join(d, 'package.json'))
    for f, old, new in edits:
        edit(os.path.join(d, f), old, new)
    print('built', name, flush=True)


try:
    for name, edits in variants.items():
        build(name, edits)
    names = list(variants)
    for r in range(1, rounds + 1):
        for name in names if r % 2 else names[::-1]:
            for row in rows:
                print(f'== round {r}/{rounds} {name}', flush=True)
                subprocess.run(['node', 'bench/frame.mjs', row], cwd=os.path.join(var, name), check=True)
finally:
    shutil.rmtree(var)
