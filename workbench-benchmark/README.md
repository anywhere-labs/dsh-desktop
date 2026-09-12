# Work / Not Work Benchmark v1.0

可重复的本地 Benchmark Harness 原型。Harness 负责任务合同、可信遥测、产物清单、独立评分和报告；平台 Adapter 只负责执行并上报事件。

## 运行

```bash
node src/cli.mjs run --adapter=local-sim --repetitions=5 --out=results/local-sim
node src/cli.mjs report results/local-sim/runs.json
node --test
```

`local-sim` 是协议验收 Adapter，不代表任何真实平台成绩。真实平台应实现 `PlatformAdapter`，并把无法取得的 token 标记为 `UNAVAILABLE`，不可填 0。

## 目录

- `spec/benchmark.v1.json`：5 道统一题、权重、Hard Fail 和评分原子项
- `src/`：协议、模拟执行器、评分器、报告 CLI
- `results/`：运行后生成的 JSON/Markdown（默认被忽略）

W0 = >=90 且无 Hard Fail；W1 = >=75；W2 = >=60；否则 W3。任何禁止操作、缺失必需产物或产物不可解析均触发 Hard Fail。
