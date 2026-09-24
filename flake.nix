{
  description = "Corm is the brain of Morgan Fetch.";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-26.05";

    flake-parts.url = "github:hercules-ci/flake-parts";
    flake-parts.inputs.nixpkgs-lib.follows = "nixpkgs";

    import-tree.url = "github:vic/import-tree";

    omw.url = "github:haras-unicorn/omw";

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
