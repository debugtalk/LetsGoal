/**
 * SKILL.md 结构校验测试
 *
 * 检查 SKILL.md 的格式规范，不是简单的关键词匹配。
 * 这些结构性要求是 Claude 首次生成时容易遗漏的。
 */

const fs = require('fs');
const path = require('path');

const skillPath = path.join(__dirname, '..', 'SKILL.md');
const content = fs.readFileSync(skillPath, 'utf-8');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${name} — ${e.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ========== Frontmatter ==========

test('frontmatter 是合法 YAML，含 name + description', () => {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert(match, '缺少 YAML frontmatter（以 --- 开头和结尾）');
  const fm = match[1];
  assert(/^name\s*:/m.test(fm), 'frontmatter 缺少 name 字段');
  assert(/^description\s*:/m.test(fm), 'frontmatter 缺少 description 字段');
});

test('frontmatter name 使用 kebab-case', () => {
  const match = content.match(/^name\s*:\s*(.+?)\s*$/m);
  assert(match, 'frontmatter 缺少 name 值');
  const name = match[1].trim();
  assert(/^[a-z][a-z0-9-]*$/.test(name), `name "${name}" 不是 kebab-case 格式`);
});

// ========== 章节结构 ==========

test('章节按规范顺序排列：适用场景 → 输入 → 输出 → 执行步骤 → 约束', () => {
  const sections = [];
  for (const m of content.matchAll(/^## (?!!#)(.+)$/gm)) {
    sections.push(m[1].trim());
  }
  const order = ['适用场景', '输入', '输出', '执行步骤', '约束'];
  let lastIdx = -1;
  for (const req of order) {
    const idx = sections.findIndex(s => s === req || s.startsWith(req));
    assert(idx !== -1, `缺少章节: ${req}`);
    assert(idx > lastIdx, `章节顺序错误: "${req}" 应在 "${order[order.indexOf(req) - 1] || '开头'}" 之后`);
    lastIdx = idx;
  }
});

test('适用场景包含 TRIGGER when 和 SKIP when', () => {
  assert(/TRIGGER\s+when/i.test(content), '缺少 TRIGGER when 条件');
  assert(/SKIP\s+when/i.test(content), '缺少 SKIP when 条件');
});

// ========== 输入输出契约 ==========

test('输入契约以表格形式列出参数', () => {
  const inputSection = content.match(/##\s+输入[\s\S]*?(?=^## [^#]|$)/);
  assert(inputSection, '缺少输入章节');
  assert(/\|.*参数.*\|.*类型.*\|/m.test(inputSection[0]), '输入章节缺少参数表格（需含"参数"和"类型"列）');
});

test('输出格式为 JSONL，字段列表以表格形式列出', () => {
  const outputSection = content.match(/##\s+输出[\s\S]*?(?=^## [^#]|$)/);
  assert(outputSection, '缺少输出章节');
  assert(/JSONL/i.test(outputSection[0]), '输出格式未声明为 JSONL');
  assert(/\|.*字段.*\|.*类型.*\|/m.test(outputSection[0]), '输出章节缺少字段表格（需含"字段"和"类型"列）');
});

test('输出字段包含全部 7 个必需字段', () => {
  const requiredFields = ['platform_name', 'rank', 'catalog_name', 'catalog_type', 'release_date', 'tag', 'collected_date'];
  const outputSection = content.match(/##\s+输出[\s\S]*?(?=^## [^#]|$)/);
  assert(outputSection, '缺少输出章节');
  for (const field of requiredFields) {
    assert(outputSection[0].includes(field), `输出缺少字段: ${field}`);
  }
});

// ========== 执行步骤 ==========

test('执行步骤至少 6 步，每步有标题', () => {
  const stepsSection = content.match(/##\s+执行步骤[\s\S]*?(?=^## [^#]|$)/);
  assert(stepsSection, '缺少执行步骤章节');
  const stepHeadings = stepsSection[0].match(/###\s+步骤\s*\d+/g) || [];
  assert(stepHeadings.length >= 6, `执行步骤只有 ${stepHeadings.length} 步，需要至少 6 步（每步用 ### 步骤 N 标题）`);
});

test('执行步骤引用 seed-runner 和 android-adb', () => {
  const stepsSection = content.match(/##\s+执行步骤[\s\S]*?(?=^## [^#]|$)/);
  assert(stepsSection, '缺少执行步骤章节');
  assert(/seed-runner|seed\s+runner/i.test(stepsSection[0]), '执行步骤未引用 seed-runner');
  assert(/android-adb/i.test(stepsSection[0]), '执行步骤未引用 android-adb');
});

test('ADB 命令用代码块包裹（反引号）', () => {
  const adbCommands = content.match(/adb\s+shell\s+[^\n]+/g) || [];
  assert(adbCommands.length > 0, '未找到 ADB 命令');
  for (const cmd of adbCommands) {
    // 检查 ADB 命令是否被反引号包裹
    const line = content.split('\n').find(l => l.includes(cmd));
    assert(line && (line.includes('`' + cmd.trim() + '`') || line.includes('`' + cmd.trim())), `ADB 命令未用反引号包裹: ${cmd.trim()}`);
  }
});

// ========== 约束 ==========

test('约束包含至少 5 条具体要求', () => {
  const constraintSection = content.match(/##\s+约束[\s\S]*?(?=^## [^#]|$)/);
  assert(constraintSection, '缺少约束章节');
  const bullets = constraintSection[0].match(/^- .+/gm) || [];
  assert(bullets.length >= 5, `约束只有 ${bullets.length} 条，需要至少 5 条`);
});

test('约束包含 force-stop 并给出完整 ADB 命令', () => {
  assert(/force-stop/i.test(content), '缺少 force-stop 要求');
  assert(/com\.tencent\.qqlive/.test(content), '缺少完整包名 com.tencent.qqlive');
});

test('约束包含 partial output 保留要求', () => {
  assert(/partial\s+output/i.test(content), '缺少 partial output 保留要求');
});

// ========== 汇总 ==========

console.log(`\n结果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
