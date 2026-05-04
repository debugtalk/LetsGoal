# 开发调试任务

> 把以下占位内容替换为你的具体需求，然后通过
> `npm run self-loop -- --direction development --input <此文件路径>` 启动自循环。
>
> 章节标题不要改动，内部内容随意。`## 配置` 必须是合法的 yaml 代码块。

## 目标

<一两句话描述这个任务要做什么。例：实现一个 fizzbuzz 函数，通过测试用例。>

## 项目根目录

<被开发项目的绝对路径，例：/home/user/projects/my-app>

## 约束

<自然语言列表，描述实现时必须遵守的规则>

- 使用 TypeScript
- 不引入新的运行时依赖
- 保持现有 API 兼容

## 禁止改动

<列出不允许被自循环修改的文件或目录，作为 forbidden_changes>

- package.json
- tsconfig.json
- test/

## Bug 复现

<task_type=bugfix 时必填：复现步骤、报错日志、触发条件；其他类型可留空或删掉本节>

## 配置

```yaml
# 任务类型:feature | bugfix | refactor | skill_creation | skill_optimize
task_type: feature

# 项目主语言(可选)。省略时由 evaluator 从 package.json/pyproject.toml 等自动探测。
language: typescript

# 验收标准
success_criteria:
  # 硬门禁:任一失败本轮就 fail
  hard_gates:
    - lint
    - typecheck
    - test

# 循环配置
loop_config:
  max_iterations: 10
  min_score: 0.92
  # 渐进式自主:strict | standard | autonomous(M2 启用,M0/M1 默认 standard)
  autonomy_mode: standard

# 三件套命令(可选)。省略字段时按以下顺序 fallback:
#   1. package.json scripts.<name>
#   2. <project_root>/.letsgoal-dev.json
#   3. 语言默认值(如 typescript: tsc --noEmit)
# 若全部 fallback 都没找到 → 该门禁被 skip,不算失败也不算通过。
commands:
  lint: npm run lint
  typecheck: npm run typecheck
  test: npm test

# 覆盖率目标(M2 启用,M0/M1 忽略)
# coverage_target: 0.8
```
