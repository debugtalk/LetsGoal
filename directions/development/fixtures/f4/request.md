# 开发调试任务

## 目标

从零创建一个「代码审查助手」Skill，使其通过所有评测用例。

创建 `SKILL.md` 文件，要求：
- 包含合法的 YAML frontmatter（name: code-reviewer, description: 代码审查助手）
- 包含「适用场景」章节，说明何时使用此 Skill
- 包含「输入/输出契约」章节，定义输入参数和输出格式
- 包含「执行步骤」章节，描述代码审查的完整流程

## 项目根目录

{{PROJECT_ROOT}}

## 约束

- 使用 Markdown 格式编写 SKILL.md
- 不引入新的运行时依赖
- SKILL.md 放在项目根目录

## 禁止改动

- package.json
- test/
- eval-cases/

## 配置

```yaml
task_type: skill_creation
language: javascript
success_criteria:
  hard_gates:
    - test
loop_config:
  max_iterations: 3
  min_score: 1.0
  autonomy_mode: standard
```
