// Builds the signed Windows installer and publishes it as a GitHub Release with latest.json for in-app updates.
// Usage: node scripts/release-desktop.mjs "这一版的更新说明"
// Needs the signing key at ~/.tauri/yanban.key (never commit it), Rust, and gh logged in.
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const REPO = "williamclark0728/yanban";
const ASSET = "Yanban-Windows-x64-setup.exe";
const notes = process.argv[2] || "";
const key = join(homedir(), ".tauri", "yanban.key");
if (!existsSync(key)) throw new Error(`没有找到签名私钥 ${key}`);

const { version, productName } = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const run = (cmd, env = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });

run("npx tauri build", {
  TAURI_SIGNING_PRIVATE_KEY: readFileSync(key, "utf8"),
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
  PATH: `${join(homedir(), ".cargo", "bin")}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
});

const dir = "src-tauri/target/release/bundle/nsis";
const built = join(dir, `${productName}_${version}_x64-setup.exe`);
const out = "src-tauri/target/release/bundle/upload";
execSync(`node -e "require('fs').mkdirSync('${out}',{recursive:true})"`);
copyFileSync(built, join(out, ASSET));
const tag = `v${version}`;
writeFileSync(
  join(out, "latest.json"),
  JSON.stringify(
    {
      version,
      notes,
      pub_date: new Date().toISOString(),
      platforms: {
        "windows-x86_64": {
          signature: readFileSync(`${built}.sig`, "utf8"),
          url: `https://github.com/${REPO}/releases/download/${tag}/${ASSET}`,
        },
      },
    },
    null,
    2,
  ),
);

const sha = execSync("git rev-parse HEAD").toString().trim();
writeFileSync(join(out, "notes.md"), notes || `研伴桌面版 ${version}`);
run(`gh release create ${tag} "${join(out, ASSET)}" "${join(out, "latest.json")}" --repo ${REPO} --target ${sha} --title "研伴桌面版 ${version}" --notes-file "${join(out, "notes.md")}"`);
console.log(`已发布 ${tag}`);
