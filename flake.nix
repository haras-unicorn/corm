{
  description = "Corm is the brain of Morgan Fetch.";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-26.05";

    flake-parts.url = "github:hercules-ci/flake-parts";
    flake-parts.inputs.nixpkgs-lib.follows = "nixpkgs";

    import-tree.url = "github:vic/import-tree";

    bun2nix.url = "github:nix-community/bun2nix";
    bun2nix.inputs.nixpkgs.follows = "nixpkgs";
    bun2nix.inputs.flake-parts.follows = "flake-parts";

    pyproject-nix.url = "github:pyproject-nix/pyproject.nix";
    pyproject-nix.inputs.nixpkgs.follows = "nixpkgs";

    uv2nix.url = "github:pyproject-nix/uv2nix";
    uv2nix.inputs.nixpkgs.follows = "nixpkgs";
    uv2nix.inputs.pyproject-nix.follows = "pyproject-nix";

    pyproject-build-systems.url = "github:pyproject-nix/build-system-pkgs";
    pyproject-build-systems.inputs.nixpkgs.follows = "nixpkgs";
    pyproject-build-systems.inputs.pyproject-nix.follows = "pyproject-nix";
    pyproject-build-systems.inputs.uv2nix.follows = "uv2nix";

    omw.url = "github:haras-unicorn/omw/refs/tags/v0.1.5";

    mcp-nix.url = "github:haras-unicorn/mcp-nix/refs/tags/v0.1.4";

    mcp-rss.url = "github:haras-unicorn/mcp-rss/refs/tags/v0.2.1";

    mcp-plan.url = "github:haras-unicorn/mcp-plan/refs/tags/v0.1.10";
  };

  outputs =
    { flake-parts, import-tree, ... }@inputs:
    flake-parts.lib.mkFlake { inherit inputs; } (import-tree ./src/nix);

  nixConfig = {
    extra-substituters = [
      "https://haras.cachix.org"
    ];
    extra-trusted-public-keys = [
      "haras.cachix.org-1:/HIo1JYqOIH1Nwk1EGXhuPPvDW0WekxIbY5CiXUZbYw="
    ];
  };
}
