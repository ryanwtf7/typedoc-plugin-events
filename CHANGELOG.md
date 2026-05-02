# Changelog

## 1.0.0 (2026-05-02)


### Bug Fixes

* normalize repository url in package.json ([c9f1b4a](https://github.com/ryanwtf7/typedoc-plugin-events/commit/c9f1b4a62dacdf283e64c9fd34cae8590aec00c5))

## 1.0.0 (Initial Release)

- Auto-generates event documentation from `EventEmitter<EventMap>` subclasses
- Reads named tuple labels as parameter names
- Forwards JSDoc `@remarks`, `@deprecated`, `@since` from event map properties
- Groups all events under `@group Events` in the generated docs
