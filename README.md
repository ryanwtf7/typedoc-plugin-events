# typedoc-plugin-events

A TypeDoc plugin that automatically generates event documentation for classes that extend Node.js `EventEmitter<EventMap>`.

Instead of manually writing `@event` JSDoc tags, this plugin reads the typed event map from the class's `EventEmitter` type parameter and injects a virtual method for each event — complete with parameter names, types, and descriptions pulled from JSDoc.

## How it works

Given a class like:

```ts
interface MyEventMap {
  /** Fired when a track starts playing */
  trackStart: [queue: Queue, track: Track];

  /**
   * Fired when a track ends.
   * @remarks Check the reason to decide whether to advance the queue.
   */
  trackFinish: [queue: Queue, track: Track, reason: TrackEndReason];
}

class Player extends EventEmitter<MyEventMap> { ... }
```

The plugin automatically adds to the `Player` docs:

- `trackStart(queue, track)` — with JSDoc description and typed parameters
- `trackFinish(queue, track, reason)` — with `@remarks` forwarded

All events are grouped under an **Events** section on the class page.

## Installation

```sh
npm install typedoc-plugin-events --save-dev
```

## Usage

Add to your `typedoc.json`:

```json
{
  "plugin": ["typedoc-plugin-events"]
}
```

Or via CLI:

```sh
typedoc --plugin typedoc-plugin-events
```

## Requirements

- TypeDoc `>=0.26.0 <0.29.0`
- Classes must extend `EventEmitter<T>` from `node:events`
- `T` must be an interface or type alias with tuple-typed properties

## JSDoc support

The plugin reads the following tags from event map interface properties:

| Tag | Effect |
|---|---|
| Plain description | Used as the event summary |
| `@remarks` | Forwarded as a remarks block tag |
| `@deprecated` | Marks the event as deprecated |
| `@since` | Forwarded as a since block tag |

Parameter names are preserved from named tuple labels — `[queue: Queue, track: Track]` produces `queue` and `track` as parameter names.

## License

Apache-2.0
