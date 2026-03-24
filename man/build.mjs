#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";

function checkDocker() {
  const result = spawnSync("docker", ["--version"], { stdio: "ignore" });
  if (result.status !== 0) {
    console.error(
      "Error: Docker is not installed. Please install it from https://docker.com/desktop"
    );
    process.exit(1);
  }
}

function runBuild() {
  const cwd = process.cwd();

  const script = `
set -euo pipefail

find /data -type f -regex '.*\\.[0-9]' | while read -r f; do
    dos2unix "$f"
    echo "man2pdf: converting file $f to \${f}.pdf"
    groff -t -man -Tpdf "$f" > "\${f}.pdf"
done
`;

  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${cwd}:/data`,
      "ubuntu",
      "bash",
      "-c",
      `
apt-get update -qq &&
apt-get install -y -qq groff ghostscript dos2unix &&
${script}
      `,
    ],
    { stdio: "inherit" }
  );

  process.exit(result.status ?? 0);
}

checkDocker();
runBuild();