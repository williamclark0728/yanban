// Fails when UI copy contains disclaimer-style phrases. Run: npm run check:copy
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const banned = [
  "仅代表", "并不代表", "不代表", "不等于", "仅作为", "只作为", "仅供参考",
  "只是验证", "本次验证", "不能作为", "不能代表", "仅用于测试", "并非全部", "免责声明",
];

const root = fileURLToPath(new URL("../src", import.meta.url));
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|css|json)$/.test(name)) files.push(p);
  }
};
walk(root);

let hits = 0;
for (const file of files) {
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    for (const word of banned) {
      if (line.includes(word)) {
        hits++;
        console.log(`${relative(process.cwd(), file)}:${i + 1}  「${word}」  ${line.trim()}`);
      }
    }
  });
}

if (hits) {
  console.log(`\n${hits} 处文案需要改写：界面只写操作、结果和状态。`);
  process.exit(1);
}
console.log(`文案检查通过（${files.length} 个文件）`);
