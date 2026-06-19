{
  description = "zorvix";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        lib = pkgs.lib;
      in
      {
        packages.default = pkgs.buildNpmPackage {
          pname = "zorvix";
          version = "2.0.3";

          src = ./.;

          npmDepsFetcherVersion = 2;
          npmDepsHash = "sha256-PMyRQMhKUNIxgiqGZpHCHu1N3nYfPdKH7E6FrY4noRs=";
          npmBuildScript = "build:src";

          installPhase = ''
            mkdir -p $out/bin
            cp -r dist/* $out/
            chmod +x $out/*.min.mjs
            ln -s $out/zorvix.min.mjs $out/bin/zorvix
          '';
        };

        devShells.default = pkgs.mkShell {
          buildInputs = [
            pkgs.nodejs_22_x
            pkgs.nodePackages.npm
            pkgs.nodePackages.tsx
          ];
        };
      });
}
