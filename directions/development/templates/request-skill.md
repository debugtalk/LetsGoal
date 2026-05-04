# Skill 创建/优化任务

> 把以下占位内容替换为你的具体需求，然后通过
> `npm run self-loop -- --direction development --input <此文件路径>` 启动自循环。
>
> 章节标题不要改动，内部内容随意。`## 配置` 必须是合法的 yaml 代码块。

## 目标

<一两句话描述这个 Skill 要做什么。例：创建一个自动化代码审查 Skill，能对 PR 进行增量 lint + 类型检查并输出报告。>

## 项目根目录

<Skill 所在项目的绝对路径，例：/home/user/projects/my-skill>

## 约束

<Skill 实现时必须遵守的规则>

- SKILL.md 必须遵循 Claude Code Skill 格式
- 不修改评测用例文件
- 保持与现有 Skill 的兼容性

## 禁止改动

<列出不允许被自循环修改的文件或目录>

- eval-cases/

## 评测集

<指定评测用例的配置。eval_suite.files 指向 JSON 评测用例文件的 glob 模式。>

```yaml
eval_suite:
  version: "1"
  files:
    - "eval-cases/**/*.json"
```

评测用例 JSON 格式：

```json
{
  "name": "用例名称",
  "input": "模拟输入描述",
  "expected_sections": ["## 适用场景", "## 输入契约", "## 执行步骤"]
}
```

## 配置

```yaml
# 任务类型:skill_creation | skill_optimize
task_type: skill_creation

# 项目主语言(可选)。省略时由 evaluator 自动探测。
language: typescript

# 验收标准
success_criteria:
  hard_gates:
    - lint
    - typecheck
    - test

# 循环配置
loop_config:
  max_iterations: 5
  min_score: 1.0
  autonomy_mode: standard

# 三件套命令(可选)。省略字段时按以下顺序 fallback:
#   1. package.json scripts.<name>
#   2. <project_root>/.letsgoal-dev.json
#   3. 语言默认值
# 若全部 fallback 都没找到 → 该门禁被 skip,不算失败也不算通过。
commands:
  lint: npm run lint
  typecheck: npm run typecheck
  test: npm test
```
