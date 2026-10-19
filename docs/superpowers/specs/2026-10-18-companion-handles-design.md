# Handles in blits-quarks and blits-tone

**Status: designed 2026-10-18, not built.** For whoever builds the next companion minors
(blits-quarks 0.8.0, blits-tone 0.3.0). It answers: what a host calls to get a quarks particle
system or a Tone node already wired to a blits mix, and what that object offers.

## Goal

Each package offers calls at the level of the library it drives. quarks has
`new ParticleSystem(opts)` and Tone has `new Tone.Synth(opts)`; the packages offer the same, but
the object returned is wired to a mix and carries blits' controls (cue a voice on it, fade, burst,
copy, drop). `drive` and `attach` stay as they are, as the layer underneath. Nothing here changes
the engine.

## Where the calls live

On the driver, because the driver already holds the mix, the kit and the one `write()` a frame:

```ts
// quarks
const q = drive(m, { kit: K, bursts: 'sparks' });
const sparks = q.particles({ startLife: new ConstantValue(0.4), shape, material });
scene.add(sparks.system.emitter);
batch.addSystem(sparks.system);
const spot = sparks.at([0, 1, 0]);
spot.cue({ patch: wave({ ... }) });
spot.burst(30);

// Tone
const t = drive(m, { kit: K, take });
const lead = t.synth({ oscillator: { type: 'sawtooth' } });
lead.node.toDestination();
lead.cue({ patch: keys({ ... }) });
const second = lead.copy();

// each frame, unchanged
m.sync(now); q.write(); t.write();
```

| Call | Returns | Does |
|---|---|---|
| `q.wire(system)` | `Source` | Takes a `ParticleSystem` the host built. |
| `q.particles(opts)` | `Source` | `q.wire(new ParticleSystem({ worldSpace: true, ...opts }))`. The driver places particles in world coordinates, so `worldSpace` defaults on. |
| `source.at(position)` | `Emitter` | A new emission point on the same system, so no second shader. `position` is what `attach` takes: a point or a function returning one. |
| `t.wire(node)` | `Sound` | Takes any Tone node the host built. |
| `t.synth(opts)`, `t.polySynth(opts)`, `t.oscillator(opts)`, `t.noise(opts)` | `Sound` | `t.wire(new Tone.X(opts))`. The list starts here; any other class goes through `wire`. |

An `Emitter` and a `Sound` are each one blits subject, and the subject is the handle object
itself, so `m.probe(spot)` reads it. On both:

- **`cue(spec)`** is `m.cue({ ...spec, subjects: [this] })`, and returns blits' own `Handle`. A
  spec that names `subjects` throws.
- **`drop()`** unwires the handle and calls `m.drop(this)`. On a `Source` it drops every emitter
  on it. It never disposes the library object: the host added it to a scene or an audio graph and
  takes it out.
- **`copy()`** makes a new, unlinked handle: Tone's is `new (node.constructor)(node.get())`, wired
  as a new subject with no voices and no connections; a `Source`'s is `system.clone()` as a new
  source with no emitters, which compiles its own shader.
- **`spot.burst(n)`** emits `n` particles at the next `write`. It is not on the tape, so a seek
  does not replay it; a burst that must survive a seek is a patch `send`, as today.

The handle exposes the library object as `system` or `node`.

## Which Tone parameters a handle drives

Tone's `drive` gains a `kit` option, as quarks' has. `wire` throws without one.

A handle drives each of the node's own properties that is a Tone `Param` or `Signal` and whose name
is a channel in the kit. Nested parameters (`synth.oscillator.frequency`) are not reached.

The parameter's value when wired is its **base**, and the channel moves it from there, by the
channel's `rest`:

| Channel `rest` | Parameter gets |
|---|---|
| `0` | base + value |
| `1` | base × value |
| anything else, or none | value, as `attach` writes today |

So a wired synth with nothing cued holds its base values. The package exports
`channels = { detune: sum(), volume: sum(), gain: mul() }` (cents, dB, and a `Gain`'s factor).
`frequency` is left out: a note sets it with `setValueAtTime` (`Monophonic.js`), and the driver's
`cancelAndHoldAtTime` would erase that, so pitch moves through `detune`. A host that adds a
`frequency` channel drives it, and its notes no longer set pitch; the README says so.

`drop()` puts each driven parameter back to its base.

## Errors

- Wiring a Tone node that a live handle already wires throws.
- `q.wire` given anything but a `ParticleSystem`, and `t.wire` given anything but a Tone node,
  throw.
- `cue` on a dropped handle throws.

## Tests

- **blits-tone**, through `test/render.ts` (an offline render compared with the mix each ms):
  - with nothing cued, a wired synth holds its base values;
  - `detune` and `volume` move from the base;
  - a note's `frequency` survives a `write`;
  - `copy()` gives equal `get()` output for each shortcut class and plays independently;
  - `drop()` restores the base values;
  - the throws above.

  A class whose copy does not survive the `get()` comparison is fixed or listed in the README.
- **blits-quarks**, through `drive.test.ts`'s fixtures:
  - two emitters on one source share one system and emit independently;
  - `burst`, `copy()` and `drop()` work;
  - dropping a source's last emitter puts the authored values back, as `detach` does.

## Docs

Each README opens with the handles. `drive`, `attach` and `detach` move to a section called "Lower
level". Each changelog lists the calls as Added; Tone's `kit` option is added, not breaking.
