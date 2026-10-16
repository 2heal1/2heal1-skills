# 社区 RFC 写法参考

需要解决特定写作问题时查对应原文，不把历史提案当作当前 API 规范，也不要求每篇新 RFC 都引用这些材料。以下取其写法，不复制其篇幅和全部流程。

| 写作问题 | 参考 | 借鉴点与边界 |
| --- | --- | --- |
| 用真实案例证明改动动机 | [Vue RFC 0013：Composition API](https://github.com/vuejs/rfcs/blob/master/active-rfcs/0013-composition-api.md) | 阅读 Code Organization、Drawbacks、Adoption strategy。用相同组件的前后对照说明逻辑组织变化，直陈新增认知成本与新旧 API 并存。长 API 教程可移入附录。 |
| 从失败场景推导取舍 | [React RFC 0214：useSyncExternalStore](https://github.com/reactjs/rfcs/blob/main/text/0214-use-sync-external-store.md) | 阅读 Detailed design、Drawbacks。将并发更新中的问题展开成事件链，再说明选择同步 store 更新的理由与限制。该文更接近 intent to ship，不作为早期探索的流程模板。 |
| 跨框架和执行环境解释架构 | [React RFC 0188：Server Components](https://github.com/reactjs/rfcs/blob/main/text/0188-server-components.md) | 阅读 Basic Example、Simplified Loading Sequence、Update (Refetch) Sequence。沿用同一案例解释各方职责与状态保留；另补项目自己的取舍与上线条件。 |
| 先理解行为，再精确解释规则 | [Rust RFC 2229：Capture Disjoint Fields](https://rust-lang.github.io/rfcs/2229-capture-disjoint-fields.html) | 阅读 Guide-level explanation、Reference-level explanation、Reference Examples。规则对应正例和反例；不能省略仍待验证的兼容问题。 |
| 补齐生产可用性与恢复责任 | [Kubernetes KEP-753：Sidecar Containers](https://github.com/kubernetes/enhancements/blob/master/keps/sig-node/753-sidecar-containers/README.md) | 阅读 Test Plan、Upgrade / Downgrade Strategy、Version Skew Strategy、Production Readiness Review。选择与项目相关的故障、观测、版本混用和回退内容；不照搬完整发布手续。 |
| 让概念、图与实现保持连续 | [Cloudflare：Fragment Piercing](https://blog.cloudflare.com/fragment-piercing/) | 用登录场景贯穿体验、DOM、请求流和实现。它是技术博客，作为 RFC 还应补上项目自己的备选方案、代价、边界和验收证据。 |

## 模板依据

- [Rust RFC 模板](https://github.com/rust-lang/rfcs/blob/master/0000-template.md)：使用层解释与精确规则分开，技术细节回到前文示例；开放问题按需要解决的阶段区分。
- [React RFC 模板](https://github.com/reactjs/rfcs/blob/main/0000-template.md)：问题与约束独立于推荐解法，并考虑既有使用者的采用成本。
- [Kubernetes KEP 模板](https://github.com/kubernetes/enhancements/blob/master/keps/NNNN-kep-template/README.md)：按需要补充生产验证与恢复条件，避免把流程完整误当作论证充分。

## 精简表达示例

以下是措辞示范，不是测量结果，也不是默认架构建议。

| 空泛表述 | 可评审的表述 |
| --- | --- |
| 新方案显著提升性能。 | 假设：并行请求可减少等待；尚无基准结果。用相同数据、环境与缓存条件比较端到端延迟，验证收益及资源开销。 |
| 插件机制更加灵活。 | 新增实现只需实现接口并注册，核心分发逻辑无需增加分支；代价是新增接口兼容责任。 |
| 迁移无缝且没有风险。 | 新旧接口在过渡期共存；调用方需要修改配置。状态能否回退尚待验证，因此当前不能承诺完整回滚。 |

删去评价词之后仍应留下机制、条件、代价或验证方法；不能只把长句缩成没有依据的短结论。
