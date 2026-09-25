# Prerequisites

[Nix] is used for managing the development shell.

## Development

To start developing, install [Nix] and run `nix develop .` in the root of the
repository to enter the default development shell of the repository flake.

## Organization

The source code is in the `src` directory.

Corm is written in [TypeScript] and organized as a [pnpm] workspace, with the
brain in `src/corm` and the flake modules under `src/nix`.

[Nix]: https://nixos.org
[TypeScript]: https://www.typescriptlang.org
[pnpm]: https://pnpm.io
