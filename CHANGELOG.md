# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.2] - 2026-06-17

### Added
- Middle-click a tile to open the pin in a new tab (Arc/browser convention).
- Pin custom views, not just files: views exposing a `starPin` descriptor now
  get a header star button and render as tiles that reopen the view.

### Changed
- Pins are now tracked by a stable key (file path or view key) so file pins and
  view pins coexist in drag-and-drop reordering.

## [1.0.1] - 2026-06-12

### Changed
- Rewrote the README to accurately document the plugin's features (Arc-style
  tiles, header star button, drag-and-drop reordering, Iconize integration).
- Corrected the MIT license copyright holder to the real author name.

### Added
- `versions.json` mapping plugin versions to the minimum Obsidian version.

## [1.0.0] - 2026-06-11

### Added
- Initial release.
