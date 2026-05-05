---
name: tencent-video-hotlist
description: 采集腾讯视频热播榜数据
---

# 腾讯视频热播榜采集 Skill

## 适用场景

TRIGGER when: 用户要求采集腾讯视频热播榜数据。

SKIP when: 目标不是腾讯视频 App。

## 输入

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| device_serial | string | 否 | ADB 设备序列号，多设备时必填 |

## 输出

每条记录一行 JSONL，字段如下：

| 字段 | 类型 | 说明 |
|------|------|------|
| platform_name | string | 固定值 `"腾讯视频"` |
| rank | number | 榜单排名，从 1 开始连续 |
| catalog_name | string | 剧名 |
| catalog_type | string | 固定值 `"电视剧"` |
| release_date | string | 上映/首播日期 |
| tag | string | 标签（如悬疑、都市等） |
| collected_date | string | 采集日期，格式 YYYY-MM-DD |

## 执行步骤

### 步骤 1

打开腾讯视频 App：使用 android-adb 执行 `` `adb shell am start -n com.tencent.qqlive/.activity.SplashHomeActivity` ``

### 步骤 2

点击搜索框进入搜索页：通过 seed-runner 定位搜索框元素并点击

### 步骤 3

收起软键盘：执行 `` `adb shell input keyevent KEYCODE_BACK` ``

### 步骤 4

导航至电视剧热播榜：通过 seed-runner 定位"电视剧"分类标签并点击，再点击"热播榜"

### 步骤 5

采集榜单数据：使用 seed-runner 逐条提取热播榜条目的 rank、catalog_name、release_date、tag 等字段，输出 JSONL

### 步骤 6

验证并输出结果：检查 rank 从 1 连续、字段完整，将 JSONL 写入输出文件

## 约束

- rank 从 1 开始连续
- 只采集完整榜单页的条目
- 采集前先执行 `` `adb shell am force-stop com.tencent.qqlive` `` 确保干净启动
- 采集中断时保留 partial output，不删除已采集的记录
- 每条记录必须包含全部 7 个输出字段，缺失字段填空字符串
